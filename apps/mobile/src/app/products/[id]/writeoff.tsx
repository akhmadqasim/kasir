import {
  allowedWriteoffReasons,
  canSeeBuyPrice,
  formatNumber,
  formatRupiah,
  id,
  parseIndonesianInteger,
  validateWriteoffQuantity,
  type Product,
  type WriteoffReason,
} from "@kasir/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Input, Label, TextField, Typography } from "heroui-native";
import { useState, type JSX } from "react";
import { View } from "react-native";

import { FieldRow } from "@/components/field-row";
import { NumberField } from "@/components/number-field";
import { ReasonSelect } from "@/components/reason-select";
import { FormSubmit } from "@/components/form-submit";
import { ProductGate } from "@/components/product-gate";
import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { InlineError } from "@/components/state-view";
import { useCreateWriteoff, useProductDetail } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";
import { savedThenBack } from "@/lib/mutation-feedback";
import { fieldVariant } from "@/lib/platform";

/**
 * Take units out of stock with a reason.
 *
 * A kasir gets damaged/expired/other; the server refuses `lost` to anyone who
 * is not an admin and refuses more units than are in stock — both are checked
 * here first so the button is disabled rather than the request rejected.
 */
export default function WriteoffScreen(): JSX.Element {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const product = useProductDetail(Number(rawId));
  const create = useCreateWriteoff();

  return (
    <ProductGate product={product}>
      {(item) => (
        <WriteoffForm
          product={item}
          reasons={allowedWriteoffReasons(user.role)}
          showLossValue={canSeeBuyPrice(user.role)}
          isPending={create.isPending}
          error={create.error}
          onSubmit={(quantity, reason, notes) =>
            create.mutate(
              {
                product: item,
                input: { productId: item.id, quantity, reason, notes: notes || undefined },
              },
              // Back to the detail, which now shows the reduced stock.
              savedThenBack(router)
            )
          }
        />
      )}
    </ProductGate>
  );
}

interface WriteoffFormProps {
  product: Product;
  reasons: readonly WriteoffReason[];
  showLossValue: boolean;
  isPending: boolean;
  error: unknown;
  onSubmit: (quantity: number, reason: WriteoffReason, notes: string) => void;
}

function WriteoffForm({
  product,
  reasons,
  showLossValue,
  isPending,
  error,
  onSubmit,
}: WriteoffFormProps): JSX.Element {
  const [quantityText, setQuantityText] = useState("");
  const [reason, setReason] = useState<WriteoffReason | null>(null);
  const [notes, setNotes] = useState("");

  const quantity = parseIndonesianInteger(quantityText);
  const quantityRule = quantity === null ? null : validateWriteoffQuantity(quantity, product.stock);
  const quantityError =
    quantityRule === "not_positive"
      ? id.stock.quantityPositive
      : quantityRule === "exceeds_stock"
        ? id.stock.quantityExceeds(`${formatNumber(product.stock)} ${product.unit}`)
        : null;

  const valid = quantity !== null && quantityRule === null && reason !== null;

  const submit = () => {
    if (!valid || isPending) return;
    onSubmit(quantity, reason, notes.trim());
  };

  const lossValue =
    showLossValue && quantity !== null && quantityRule === null
      ? formatRupiah(product.buy_price * quantity)
      : null;

  return (
    <ScrollScreen>
      <View className="gap-1">
        <Typography.Heading type="h4">{product.name}</Typography.Heading>
        <Typography type="body-sm" color="muted">
          {id.stock.writeoffDescription}
        </Typography>
      </View>

      <Section>
        <FieldRow
          label={id.stock.systemLabel}
          value={`${formatNumber(product.stock)} ${product.unit}`}
        />
        {lossValue ? <FieldRow label={id.stock.lossValue} value={lossValue} emphasize /> : null}
      </Section>

      <Section variant="fields">
        <NumberField
          label={id.stock.quantity}
          value={quantityText}
          onChangeText={setQuantityText}
          parsed={quantity}
          error={quantityError}
          isRequired
          autoFocus
          returnKeyType="next"
        />

        <ReasonSelect
          reasons={reasons}
          value={reason}
          onChange={setReason}
          description={reasons.includes("lost") ? undefined : id.stock.lostAdminOnly}
        />

        <TextField>
          <Label>{id.stock.notes}</Label>
          <Input
            variant={fieldVariant}
            value={notes}
            onChangeText={setNotes}
            placeholder={id.stock.notesPlaceholder}
            multiline
            numberOfLines={3}
          />
        </TextField>
      </Section>

      <InlineError error={error} />

      <FormSubmit
        label={id.stock.submitWriteoff}
        destructive
        isDisabled={!valid}
        isPending={isPending}
        onPress={submit}
      />
    </ScrollScreen>
  );
}
