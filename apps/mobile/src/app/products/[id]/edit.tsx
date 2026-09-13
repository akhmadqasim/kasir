import {
  canEditProduct,
  formatNumber,
  id,
  parseIndonesianInteger,
  parseIndonesianNumber,
  type Category,
  type Product,
} from "@kasir/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Typography } from "heroui-native";
import { useState, type JSX } from "react";

import { CategorySelect } from "@/components/category-select";
import { NumberField } from "@/components/number-field";
import { FormSubmit } from "@/components/form-submit";
import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { ErrorView, InlineError, LoadingView } from "@/components/state-view";
import { useCategories, usePatchProduct, useProductDetail } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";
import { savedThenBack } from "@/lib/mutation-feedback";

/**
 * Admin: sell price, buy price, minimum stock, category. Stock itself is not
 * here on purpose — it changes through a count or a write-off, so that a price
 * edit can never silently rewrite the stock the server has since sold from.
 */
export default function EditProductScreen(): JSX.Element {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const product = useProductDetail(Number(rawId));
  const categories = useCategories();
  const patch = usePatchProduct();

  if (product.isPending) return <LoadingView />;
  if (product.isError) {
    return (
      <ScrollScreen>
        <ErrorView error={product.error} onRetry={() => void product.refetch()} />
      </ScrollScreen>
    );
  }
  if (!canEditProduct(user.role)) {
    return (
      <ScrollScreen>
        <Typography color="muted">{id.stock.adjustAdminOnly}</Typography>
      </ScrollScreen>
    );
  }

  return (
    <EditForm
      product={product.data}
      categories={categories.data ?? []}
      isPending={patch.isPending}
      error={patch.error}
      onSubmit={(values) =>
        patch.mutate({ product: product.data, patch: values }, savedThenBack(router))
      }
    />
  );
}

interface EditValues {
  sell_price: number;
  buy_price: number;
  min_stock: number;
  category_id: number | null;
}

interface EditFormProps {
  product: Product;
  categories: Category[];
  isPending: boolean;
  error: unknown;
  onSubmit: (values: EditValues) => void;
}

function EditForm({ product, categories, isPending, error, onSubmit }: EditFormProps): JSX.Element {
  const [sellPrice, setSellPrice] = useState(formatNumber(product.sell_price));
  const [buyPrice, setBuyPrice] = useState(formatNumber(product.buy_price));
  const [minStock, setMinStock] = useState(String(product.min_stock));
  const [categoryId, setCategoryId] = useState<number | null>(product.category_id);

  const sell = parseIndonesianNumber(sellPrice);
  const buy = parseIndonesianNumber(buyPrice);
  const min = parseIndonesianInteger(minStock);

  const valid = sell !== null && sell >= 0 && buy !== null && buy >= 0 && min !== null && min >= 0;

  const submit = () => {
    if (!valid || isPending) return;
    onSubmit({ sell_price: sell, buy_price: buy, min_stock: min, category_id: categoryId });
  };

  return (
    <ScrollScreen>
      <Typography.Heading type="h4">{product.name}</Typography.Heading>

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
          isRequired
          returnKeyType="next"
        />
      </Section>

      <Section title={id.products.sectionStock} variant="fields">
        <NumberField
          label={id.products.minStock}
          value={minStock}
          onChangeText={setMinStock}
          parsed={min}
          isRequired
          onSubmitEditing={submit}
        />
      </Section>

      <Section title={id.products.sectionIdentity} variant="fields">
        <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
      </Section>

      <InlineError error={error} />

      <FormSubmit
        label={id.common.save}
        isDisabled={!valid}
        isPending={isPending}
        onPress={submit}
      />
    </ScrollScreen>
  );
}
