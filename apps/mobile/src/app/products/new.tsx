import {
  canEditProduct,
  id,
  parseIndonesianInteger,
  parseIndonesianNumber,
  type Product,
} from "@kasir/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Input, Label, Spinner, TextField, Typography } from "heroui-native";
import { useState, type JSX } from "react";

import { CategorySelect } from "@/components/category-select";
import { NumberField } from "@/components/number-field";
import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { InlineError } from "@/components/state-view";
import { primeProduct, useCategories, useCreateProduct } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { fieldVariant } from "@/lib/platform";

/**
 * Admin: register a product the scanner did not know. The barcode arrives
 * pre-filled; everything else is the minimum `POST /products` accepts.
 */
export default function NewProductScreen(): JSX.Element {
  const { barcode: presetBarcode } = useLocalSearchParams<{ barcode?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const categories = useCategories();
  const create = useCreateProduct();

  const [barcode, setBarcode] = useState(presetBarcode ?? "");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [sellPrice, setSellPrice] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [minStock, setMinStock] = useState("0");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  if (!canEditProduct(user.role)) {
    return (
      <ScrollScreen>
        <Typography color="muted">{id.stock.adjustAdminOnly}</Typography>
      </ScrollScreen>
    );
  }

  const sell = parseIndonesianNumber(sellPrice);
  const buy = buyPrice.trim() ? parseIndonesianNumber(buyPrice) : 0;
  const stockValue = parseIndonesianInteger(stock);
  const min = parseIndonesianInteger(minStock);

  const valid =
    name.trim().length > 0 &&
    unit.trim().length > 0 &&
    sell !== null &&
    sell >= 0 &&
    buy !== null &&
    buy >= 0 &&
    stockValue !== null &&
    stockValue >= 0 &&
    min !== null &&
    min >= 0;

  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate(
      {
        barcode: barcode.trim() || null,
        sku: sku.trim() || null,
        name: name.trim(),
        category_id: categoryId,
        buy_price: buy,
        sell_price: sell,
        stock: stockValue,
        unit: unit.trim(),
        min_stock: min,
      },
      {
        onSuccess: (product: Product) => {
          hapticSuccess();
          primeProduct(queryClient, product);
          router.replace({ pathname: "/products/[id]", params: { id: String(product.id) } });
        },
        onError: hapticError,
      }
    );
  };

  return (
    <ScrollScreen>
      <Section title={id.products.sectionIdentity} variant="fields">
        <TextField isRequired>
          <Label>{id.products.name}</Label>
          <Input
            variant={fieldVariant}
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="next"
          />
        </TextField>

        <TextField>
          <Label>{id.products.barcode}</Label>
          <Input
            variant={fieldVariant}
            value={barcode}
            onChangeText={setBarcode}
            keyboardType="number-pad"
            autoCorrect={false}
          />
        </TextField>

        <TextField>
          <Label>{id.products.sku}</Label>
          <Input
            variant={fieldVariant}
            value={sku}
            onChangeText={setSku}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </TextField>

        <TextField isRequired>
          <Label>{id.products.unit}</Label>
          <Input
            variant={fieldVariant}
            value={unit}
            onChangeText={setUnit}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </TextField>

        <CategorySelect
          categories={categories.data ?? []}
          value={categoryId}
          onChange={setCategoryId}
        />
      </Section>

      <Section title={id.products.sectionPrice} variant="fields">
        <NumberField
          label={id.products.sellPrice}
          value={sellPrice}
          onChangeText={setSellPrice}
          parsed={sell}
          decimal
          isRequired
          returnKeyType="next"
        />
        <NumberField
          label={id.products.buyPrice}
          value={buyPrice}
          onChangeText={setBuyPrice}
          parsed={buy}
          decimal
          returnKeyType="next"
        />
      </Section>

      <Section title={id.products.sectionStock} variant="fields">
        <NumberField
          label={id.products.stock}
          value={stock}
          onChangeText={setStock}
          parsed={stockValue}
          isRequired
          returnKeyType="next"
        />
        <NumberField
          label={id.products.minStock}
          value={minStock}
          onChangeText={setMinStock}
          parsed={min}
          isRequired
          onSubmitEditing={submit}
        />
      </Section>

      <InlineError error={create.error} />

      <Button isDisabled={!valid || create.isPending} onPress={submit}>
        {create.isPending ? <Spinner size="sm" /> : <Button.Label>{id.common.save}</Button.Label>}
      </Button>
    </ScrollScreen>
  );
}
