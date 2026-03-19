/// ESC/POS command builder for thermal printers
/// Supports 58mm (32 char) and 80mm (42 char) paper widths

pub struct EscPosBuilder {
    buffer: Vec<u8>,
    width: u8, // chars per line
}

impl EscPosBuilder {
    pub fn new(paper_width_mm: u8) -> Self {
        let width = match paper_width_mm {
            58 => 32,
            80 => 42,
            _ => 32,
        };
        let mut builder = Self {
            buffer: Vec::new(),
            width,
        };
        builder.init();
        builder
    }

    pub fn chars_per_line(&self) -> u8 {
        self.width
    }

    /// Initialize printer (ESC @)
    fn init(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x40]);
        self
    }

    /// Print text as-is
    pub fn text(&mut self, s: &str) -> &mut Self {
        self.buffer.extend_from_slice(s.as_bytes());
        self
    }

    /// Print text followed by line feed
    pub fn line(&mut self, s: &str) -> &mut Self {
        self.buffer.extend_from_slice(s.as_bytes());
        self.buffer.push(0x0A);
        self
    }

    /// Line feed
    pub fn feed(&mut self, lines: u8) -> &mut Self {
        for _ in 0..lines {
            self.buffer.push(0x0A);
        }
        self
    }

    /// Align left (ESC a 0)
    pub fn align_left(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x61, 0x00]);
        self
    }

    /// Align center (ESC a 1)
    pub fn align_center(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x61, 0x01]);
        self
    }

    /// Align right (ESC a 2)
    pub fn align_right(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x61, 0x02]);
        self
    }

    /// Bold on (ESC E 1)
    pub fn bold_on(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x45, 0x01]);
        self
    }

    /// Bold off (ESC E 0)
    pub fn bold_off(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x45, 0x00]);
        self
    }

    /// Double height + width (ESC ! 0x30)
    pub fn double_size_on(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x21, 0x30]);
        self
    }

    /// Normal size (ESC ! 0x00)
    pub fn double_size_off(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1B, 0x21, 0x00]);
        self
    }

    /// Print a full-width separator line
    pub fn separator(&mut self, ch: char) -> &mut Self {
        let line: String = std::iter::repeat(ch).take(self.width as usize).collect();
        self.line(&line)
    }

    /// Print text left-justified, padded to width
    pub fn left_text(&mut self, s: &str) -> &mut Self {
        let truncated = truncate_str(s, self.width as usize);
        self.line(&truncated)
    }

    /// Print two columns: left-aligned text and right-aligned text
    pub fn two_columns(&mut self, left: &str, right: &str) -> &mut Self {
        let w = self.width as usize;
        let right_len = right.len().min(w);
        let left_max = w.saturating_sub(right_len + 1);
        let left_trunc = truncate_str(left, left_max);
        let padding = w.saturating_sub(left_trunc.len() + right_len);
        let line = format!(
            "{}{}{}",
            left_trunc,
            " ".repeat(padding),
            right
        );
        self.line(&line)
    }

    /// Cut paper (GS V 1 = partial cut)
    pub fn cut(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1D, 0x56, 0x01]);
        self
    }

    /// Full cut (GS V 0)
    pub fn full_cut(&mut self) -> &mut Self {
        self.buffer.extend_from_slice(&[0x1D, 0x56, 0x00]);
        self
    }

    /// Open cash drawer (ESC p 0 25 250)
    pub fn open_cash_drawer(&mut self) -> &mut Self {
        self.buffer
            .extend_from_slice(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
        self
    }

    /// Get the built byte buffer
    pub fn build(self) -> Vec<u8> {
        self.buffer
    }
}

/// Truncate a string to fit within max_len characters
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        s[..max_len].to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_58mm_width() {
        let builder = EscPosBuilder::new(58);
        assert_eq!(builder.chars_per_line(), 32);
    }

    #[test]
    fn test_80mm_width() {
        let builder = EscPosBuilder::new(80);
        assert_eq!(builder.chars_per_line(), 42);
    }

    #[test]
    fn test_two_columns() {
        let mut builder = EscPosBuilder::new(58);
        builder.two_columns("TOTAL", "100.000");
        let output = String::from_utf8_lossy(&builder.build());
        assert!(output.contains("TOTAL"));
        assert!(output.contains("100.000"));
    }

    #[test]
    fn test_separator() {
        let mut builder = EscPosBuilder::new(58);
        builder.separator('-');
        let output = builder.build();
        // ESC @ (2 bytes) + 32 dashes + LF
        assert_eq!(output.len(), 2 + 32 + 1);
    }
}
