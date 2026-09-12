import { id, type Category } from "@kasir/shared";
import { Label, Select, TextField } from "heroui-native";
import type { JSX } from "react";

interface CategorySelectProps {
  categories: Category[];
  value: number | null;
  onChange: (categoryId: number | null) => void;
}

const NONE = "__none__";

/** Category picker; "Tanpa kategori" is a real choice, not an empty state. */
export function CategorySelect({ categories, value, onChange }: CategorySelectProps): JSX.Element {
  const selected =
    value === null
      ? { value: NONE, label: id.products.noCategory }
      : (() => {
          const match = categories.find((category) => category.id === value);
          return match
            ? { value: String(match.id), label: match.name }
            : { value: NONE, label: id.products.noCategory };
        })();

  return (
    <TextField>
      <Label>{id.products.category}</Label>
      <Select
        value={selected}
        onValueChange={(option) => {
          if (!option || Array.isArray(option)) return;
          onChange(option.value === NONE ? null : Number(option.value));
        }}
      >
        <Select.Trigger>
          <Select.Value placeholder={id.products.category} />
          <Select.TriggerIndicator />
        </Select.Trigger>
        <Select.Portal>
          <Select.Overlay />
          <Select.Content presentation="popover">
            <Select.Item value={NONE} label={id.products.noCategory} />
            {categories.map((category) => (
              <Select.Item key={category.id} value={String(category.id)} label={category.name} />
            ))}
          </Select.Content>
        </Select.Portal>
      </Select>
    </TextField>
  );
}
