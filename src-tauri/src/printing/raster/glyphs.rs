//! The raster backend on Linux: the bundled face drawn with
//! `ab_glyph`, a pure-Rust rasterizer, so the picture needs nothing from the
//! system.
//!
//! It keeps the GDI backend's rules: the same face, characters on the same
//! cell grid, the glyphs centred in their cell, one-dot strokes, and bold as a
//! one-dot overstrike, which is what GDI does for a face without a bold of its
//! own.

use std::sync::OnceLock;

use ab_glyph::{point, Font, FontRef, PxScale};

use super::{line_height, Bitmap1bpp, CELL_HEIGHT, CELL_WIDTH, GLYPH_HEIGHT, TYPEWRITER_TTF};
use crate::printing::receipt::{LineSize, ReceiptTextLine};

/// A pixel is a dot when the outline covers at least half of it, which is what
/// GDI's non-antialiased mode decides from the pixel centre.
const INK_COVERAGE: f32 = 0.5;

const FONT_ERROR: &str = "Gagal memuat font struk";

/// Draw `lines` into a `dots_wide` x `height` picture whose text block starts
/// `left` dots in.
pub(super) fn draw(
    lines: &[ReceiptTextLine],
    dots_wide: u32,
    height: u32,
    left: u32,
) -> Result<Bitmap1bpp, String> {
    let faces = faces()?;
    let mut bitmap = Bitmap1bpp::blank(dots_wide, height);

    let mut cell_top = 0;
    for line in lines {
        if !line.text.trim().is_empty() {
            // As in the GDI backend: a double-size line is never bold.
            let (face, bold) = match line.size {
                LineSize::Double => (&faces.doubled, false),
                LineSize::Normal => (&faces.normal, line.bold),
            };
            face.draw_line(&mut bitmap, &line.text, bold, left, cell_top);
        }
        cell_top += line_height(line);
    }

    Ok(bitmap)
}

/// The bundled face at both sizes.
struct Faces {
    normal: Face,
    doubled: Face,
}

/// Parsed and measured once for the life of the process.
fn faces() -> Result<&'static Faces, String> {
    static FACES: OnceLock<Result<Faces, String>> = OnceLock::new();
    FACES
        .get_or_init(|| {
            let font =
                FontRef::try_from_slice(TYPEWRITER_TTF).map_err(|_| FONT_ERROR.to_string())?;
            Ok(Faces {
                normal: Face::new(font.clone(), CELL_WIDTH, GLYPH_HEIGHT, CELL_HEIGHT)?,
                doubled: Face::new(font, CELL_WIDTH * 2, GLYPH_HEIGHT * 2, CELL_HEIGHT * 2)?,
            })
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// The face at one size.
struct Face {
    font: FontRef<'static>,
    scale: PxScale,
    /// Dots from one character to the next: the cell width, not the font's own
    /// advance, so every character sits exactly in its column.
    advance: u32,
    /// Dots from the top of a cell down to the baseline.
    baseline: f32,
}

impl Face {
    /// The face with characters `advance` dots apart and an em `glyph_height`
    /// dots tall (the two numbers the GDI backend gives `CreateFontW`), in
    /// cells `cell_height` dots tall. Width and height are scaled separately,
    /// so the glyphs are stretched upwards the way GDI stretches them.
    ///
    /// The face's ink reaches further than its em: brackets, `|` and the
    /// descenders of `g j p q y`. When that ink would not fit the cell, the
    /// height shrinks until it does, so no line bleeds into the next one and
    /// the last line of a slip keeps its descenders.
    fn new(
        font: FontRef<'static>,
        advance: u32,
        glyph_height: i32,
        cell_height: u32,
    ) -> Result<Self, String> {
        let em = font.units_per_em().ok_or_else(|| FONT_ERROR.to_string())?;
        let char_advance = font.h_advance_unscaled(font.glyph_id('0'));
        let (ink_top, ink_bottom) = ink_extent(&font).ok_or_else(|| FONT_ERROR.to_string())?;
        if char_advance <= 0.0 || ink_top <= ink_bottom {
            return Err(FONT_ERROR.to_string());
        }

        // Dots per font unit, vertically: the asked-for em, or less if the ink
        // would overflow the cell.
        let ink_units = ink_top - ink_bottom;
        let dots_per_unit = (glyph_height as f32 / em).min(cell_height as f32 / ink_units);
        // `PxScale` measures both axes against the face's own height.
        let height = font.height_unscaled();
        let scale = PxScale {
            x: advance as f32 * height / char_advance,
            y: dots_per_unit * height,
        };
        let ink_margin = (cell_height as f32 - ink_units * dots_per_unit) / 2.0;

        Ok(Self {
            font,
            scale,
            advance,
            baseline: ink_margin + ink_top * dots_per_unit,
        })
    }

    /// Draw one line of text in the cell that starts `cell_top` dots down.
    fn draw_line(&self, bitmap: &mut Bitmap1bpp, text: &str, bold: bool, left: u32, cell_top: u32) {
        let baseline = cell_top as f32 + self.baseline;
        let strike = if bold { 2 } else { 1 };

        for (column, character) in text.chars().enumerate() {
            let x = (left + column as u32 * self.advance) as f32;
            let glyph = self
                .font
                .glyph_id(character)
                .with_scale_and_position(self.scale, point(x, baseline));
            // Spaces and other blanks have no outline.
            let Some(outline) = self.font.outline_glyph(glyph) else {
                continue;
            };

            let origin = outline.px_bounds().min;
            outline.draw(|dx, dy, coverage| {
                if coverage >= INK_COVERAGE {
                    let x = origin.x as i64 + i64::from(dx);
                    let y = origin.y as i64 + i64::from(dy);
                    for offset in 0..strike {
                        bitmap.burn(x + offset, y);
                    }
                }
            });
        }
    }
}

/// How far the printable ASCII range reaches above (positive) and below
/// (negative) the baseline, in font units. Receipt text is that range.
fn ink_extent(font: &FontRef) -> Option<(f32, f32)> {
    (' '..='~')
        .filter_map(|character| font.outline(font.glyph_id(character)))
        .map(|outline| (outline.bounds.max.y, outline.bounds.min.y))
        .reduce(|(top, bottom), (t, b)| (top.max(t), bottom.min(b)))
}

impl Bitmap1bpp {
    /// White paper: no dot burned yet.
    fn blank(width: u32, height: u32) -> Self {
        let data = vec![0_u8; (width.div_ceil(8) * height) as usize];
        Self {
            width,
            height,
            data,
        }
    }

    /// Burn the dot at `(x, y)`; a dot off the paper is dropped.
    fn burn(&mut self, x: i64, y: i64) {
        let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y)) else {
            return;
        };
        if x >= self.width || y >= self.height {
            return;
        }
        let index = (y * self.bytes_per_row() + x / 8) as usize;
        self.data[index] |= 0x80 >> (x % 8);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::printing::receipt::ReceiptTextLine;

    const PAPER: u32 = 384;

    fn is_burned(bitmap: &Bitmap1bpp, x: u32, y: u32) -> bool {
        let index = (y * bitmap.bytes_per_row() + x / 8) as usize;
        bitmap.data[index] & (0x80 >> (x % 8)) != 0
    }

    fn ink(bitmap: &Bitmap1bpp) -> Vec<(u32, u32)> {
        (0..bitmap.height)
            .flat_map(|y| (0..bitmap.width).map(move |x| (x, y)))
            .filter(|&(x, y)| is_burned(bitmap, x, y))
            .collect()
    }

    fn line(text: &str, bold: bool, size: LineSize) -> ReceiptTextLine {
        ReceiptTextLine {
            text: text.to_string(),
            bold,
            size,
        }
    }

    #[test]
    fn burn_sets_the_leftmost_dot_of_a_byte_in_the_high_bit() {
        let mut bitmap = Bitmap1bpp::blank(16, 2);
        bitmap.burn(0, 0);
        bitmap.burn(9, 1);
        assert_eq!(bitmap.data, [0b1000_0000, 0, 0, 0b0100_0000]);
    }

    #[test]
    fn burn_ignores_dots_off_the_paper() {
        let mut bitmap = Bitmap1bpp::blank(10, 4);
        for (x, y) in [
            (-1, 0),
            (0, -1),
            (10, 0),
            (0, 4),
            (i64::MIN, 0),
            (0, i64::MAX),
        ] {
            bitmap.burn(x, y);
        }
        assert!(bitmap.data.iter().all(|&byte| byte == 0));
    }

    #[test]
    fn burn_keeps_the_last_dot_on_the_paper() {
        let mut bitmap = Bitmap1bpp::blank(10, 4);
        bitmap.burn(9, 3);
        assert_eq!(ink(&bitmap), [(9, 3)]);
    }

    #[test]
    fn a_bold_line_adds_dots_to_the_same_text_plain() {
        let plain = draw(&[line("Beras 5kg", false, LineSize::Normal)], PAPER, 32, 0).unwrap();
        let bold = draw(&[line("Beras 5kg", true, LineSize::Normal)], PAPER, 32, 0).unwrap();
        assert!(!ink(&plain).is_empty());
        assert!(ink(&bold).len() > ink(&plain).len());
        assert!(ink(&plain).iter().all(|&(x, y)| is_burned(&bold, x, y)));
    }

    #[test]
    fn a_double_size_line_burns_the_same_dots_whether_or_not_it_is_bold() {
        let plain = draw(&[line("Total", false, LineSize::Double)], PAPER, 64, 0).unwrap();
        let bold = draw(&[line("Total", true, LineSize::Double)], PAPER, 64, 0).unwrap();
        assert!(!ink(&plain).is_empty());
        assert_eq!(plain.data, bold.data);
    }

    #[test]
    fn a_double_size_line_with_descenders_keeps_its_ink_inside_its_two_cells() {
        let cells = CELL_HEIGHT * 2;
        let bitmap = draw(
            &[line("Agjpqy|[]", false, LineSize::Double)],
            PAPER,
            cells * 2,
            0,
        )
        .unwrap();
        assert!(ink(&bitmap).iter().all(|&(_, y)| y < cells));
    }

    #[test]
    fn a_blank_line_burns_nothing() {
        let bitmap = draw(&[line("    ", true, LineSize::Normal)], PAPER, 32, 0).unwrap();
        assert!(ink(&bitmap).is_empty());
    }

    #[test]
    fn the_second_line_is_drawn_below_the_first_cell() {
        let bitmap = draw(
            &[
                line("", false, LineSize::Normal),
                line("Minyak", false, LineSize::Normal),
            ],
            PAPER,
            CELL_HEIGHT * 2,
            0,
        )
        .unwrap();
        let dots = ink(&bitmap);
        assert!(!dots.is_empty());
        assert!(dots.iter().all(|&(_, y)| y >= CELL_HEIGHT));
    }

    #[test]
    fn every_character_of_a_full_32_column_line_stays_inside_the_paper() {
        // The picture is wider than the paper so a character spilling past the
        // last column would be seen rather than clipped by `burn`.
        let wide = PAPER + 8 * CELL_WIDTH;
        for character in (' '..='~').chain(['é', 'Ω']) {
            let text: String = std::iter::repeat_n(' ', 31).chain([character]).collect();
            let bitmap = draw(&[line(&text, false, LineSize::Normal)], wide, 32, 0).unwrap();
            assert!(
                ink(&bitmap).iter().all(|&(x, _)| x < PAPER),
                "{character:?} in column 32 reaches past the paper"
            );
        }
    }

    #[test]
    fn bold_pushes_the_last_column_at_most_one_dot_past_the_paper() {
        let wide = PAPER + 8 * CELL_WIDTH;
        let bitmap = draw(
            &[line(&"W".repeat(32), true, LineSize::Normal)],
            wide,
            32,
            0,
        )
        .unwrap();
        assert!(ink(&bitmap).iter().all(|&(x, _)| x <= PAPER));
    }
}
