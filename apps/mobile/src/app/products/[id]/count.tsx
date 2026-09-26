import {
  allowedWriteoffReasons,
  formatNumber,
  id,
  parseIndonesianInteger,
  resolveStockCount,
  type Product,
  type StockCountOutcome,
  type WriteoffReason,
} from "@kasir/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Typography } from "heroui-native";
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
import { useAdjustStock, useCreateWriteoff, useProductDetail } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";
import { savedThenBack } from "@/lib/mutation-feedback";

/**
 * Stock count (opname) for one product: type what is on the shelf, see the
 * difference against the system, and settle it.
 *
 * - Admin: the count becomes the new stock (`PUT /products/{id}` with `stock`
 *   replaced — the only endpoint that can do it). Explaining a shortfall with a
 *   reason turns it into a write-off instead, which leaves an audit row.
 * - Kasir: a shortfall can only be settled as a damaged/expired/other
 *   write-off; a surplus needs an admin. Both rules live in `@kasir/shared`
 *   `resolveStockCount` and are enforced again by the server.
 *
 * The difference is worked out against the system stock, so the row is re-read
 * on every visit and the button waits for it: the list's copy may predate sales
 * the desktop has made since, and those would be written off as a shortfall.
 */
export default function StockCountScreen(): JSX.Element {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const product = useProductDetail(Number(rawId), { alwaysFresh: true });
  const adjust = useAdjustStock();
  const writeoff = useCreateWriteoff();

  const isPending = adjust.isPending || writeoff.isPending || product.isFetching;

  return (
    <ProductGate product={product}>
      {(item) => (
        <CountForm
          product={item}
          role={user.role}
          isPending={isPending}
          error={adjust.error ?? writeoff.error}
          onAdjust={(countedStock) =>
            adjust.mutate({ product: item, countedStock }, savedThenBack(router))
          }
          onWriteoff={(quantity, reason) =>
            writeoff.mutate(
              {
                product: item,
                input: { productId: item.id, quantity, reason, notes: id.stock.count },
              },
              savedThenBack(router)
            )
          }
        />
      )}
    </ProductGate>
  );
}

interface CountFormProps {
  product: Product;
  role: "admin" | "kasir";
  isPending: boolean;
  error: unknown;
  onAdjust: (countedStock: number) => void;
  onWriteoff: (quantity: number, reason: WriteoffReason) => void;
}

function CountForm({
  product,
  role,
  isPending,
  error,
  onAdjust,
  onWriteoff,
}: CountFormProps): JSX.Element {
  const [countedText, setCountedText] = useState("");
  const [reason, setReason] = useState<WriteoffReason | null>(null);

  const counted = parseIndonesianInteger(countedText);
  const countedError = counted !== null && counted < 0 ? id.common.invalidNumber : null;
  const outcome: StockCountOutcome | null =
    counted === null || counted < 0
      ? null
      : resolveStockCount({
          role,
          systemStock: product.stock,
          countedStock: counted,
          writeoffReason: reason,
        });

  const difference = outcome && outcome.kind !== "match" ? outcome.difference : 0;
  const shortfall = counted !== null && counted < product.stock;
  const reasons = allowedWriteoffReasons(role);

  const submit = () => {
    if (!outcome || isPending) return;
    if (outcome.kind === "adjust") onAdjust(outcome.newStock);
    if (outcome.kind === "writeoff" && reason) onWriteoff(outcome.quantity, reason);
  };

  const submitLabel =
    outcome?.kind === "writeoff" ? id.stock.submitWriteoff : id.stock.submitAdjust;
  const canSubmit = outcome?.kind === "adjust" || outcome?.kind === "writeoff";

  return (
    <ScrollScreen>
      <View className="gap-1">
        <Typography.Heading type="h4">{product.name}</Typography.Heading>
        <Typography type="body-sm" color="muted">
          {id.stock.countDescription}
        </Typography>
      </View>

      <Section>
        <FieldRow
          label={id.stock.systemLabel}
          value={`${formatNumber(product.stock)} ${product.unit}`}
        />
        {outcome ? (
          <FieldRow
            label={id.stock.differenceLabel}
            value={
              outcome.kind === "match"
                ? id.stock.noDifference
                : `${difference > 0 ? "+" : ""}${formatNumber(difference)} ${product.unit}`
            }
            emphasize
            danger={difference < 0}
          />
        ) : null}
      </Section>

      <Section variant="fields">
        <NumberField
          label={id.stock.countedLabel}
          value={countedText}
          onChangeText={setCountedText}
          parsed={counted}
          error={countedError}
          isRequired
          autoFocus
          onSubmitEditing={submit}
        />

        {shortfall ? (
          <ReasonSelect
            reasons={reasons}
            value={reason}
            onChange={setReason}
            description={role === "admin" ? undefined : id.stock.lostAdminOnly}
          />
        ) : null}
      </Section>

      {outcome?.kind === "blocked" ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              {outcome.reason === "surplus_needs_admin"
                ? id.stock.surplusNeedsAdmin
                : id.stock.adjustAdminOnly}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <InlineError error={error} />

      <FormSubmit
        label={submitLabel}
        isDisabled={!canSubmit}
        isPending={isPending}
        onPress={submit}
      />
    </ScrollScreen>
  );
}
