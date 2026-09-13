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
import { ScrollScreen } from "@/components/screen";
import { Section } from "@/components/section";
import { ErrorView, InlineError, LoadingView } from "@/components/state-view";
import { useCreateWriteoff, useProductDetail } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";
import { savedThenBack } from "@/lib/mutation-feedback";
import { fieldVariant } from "@/lib/platform";

/**
 * Take units out of stock with a reason. `quantity` and `reason` may arrive
 * pre-filled from the stock count screen.
 *
 * A kasir gets damaged/expired; the server refuses `lost` to anyone who is not
 * an admin and refuses more units than are in stock — both are checked here
 * first so the button is disabled rather than the request rejected.
 */
export default function WriteoffScreen(): JSX.Element {
  const params = useLocalSearchParams<{ id: string; quantity?: string; reason?: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const product = useProductDetail(Number(params.id));
  const create = useCreateWriteoff();

  if (product.isPending) return <LoadingView />;
  if (product.isError) {
    return (
      <ScrollScreen>
        <ErrorView error={product.error} onRetry={() => void product.refetch()} />
      </ScrollScreen>
    );
  }

  const reasons = allowedWriteoffReasons(user.role);
  const presetReason = reasons.find((reason) => reason === params.reason) ?? null;

  return (
    <WriteoffForm
      product={product.data}
      reasons={reasons}
      showLossValue={canSeeBuyPrice(user.role)}
      initialQuantity={params.quantity ?? ""}
      initialReason={presetReason}
      isPending={create.isPending}
      error={create.error}
      onSubmit={(quantity, reason, notes) =>
        create.mutate(
          {
            product: product.data,
            input: { productId: product.data.id, quantity, reason, notes: notes || undefined },
          },
          // Back to the detail, which now shows the reduced stock.
          savedThenBack(router)
        )
      }
    />
  );
}

interface WriteoffFormProps {
  product: Product;
  reasons: readonly WriteoffReason[];
  showLossValue: boolean;
  initialQuantity: string;
  initialReason: WriteoffReason | null;
  isPending: boolean;
  error: unknown;
  onSubmit: (quantity: number, reason: WriteoffReason, notes: string) => void;
}

function WriteoffForm({
  product,
  reasons,
  showLossValue,
  initialQuantity,
  initialReason,
  isPending,
  error,
  onSubmit,
}: WriteoffFormProps): JSX.Element {
  const [quantityText, setQuantityText] = useState(initialQuantity);
  const [reason, setReason] = useState<WriteoffReason | null>(initialReason);
  const [notes, setNotes] = useState("");

  const quantity = parseIndonesianInteger(quantityText);
  const quantityRule = quantity === null ? null : validateWriteoffQuantity(quantity, product.stock);
  const quantityError =
    quantityRule === "not_positive"
      ? id.stock.quantityPositive
      : quantityRule === "exceeds_stock"
        ? id.stock.quantityExceeds
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
          autoFocus={initialQuantity.length === 0}
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
