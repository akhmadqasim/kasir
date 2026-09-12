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
import { Alert, Button, Spinner, Typography } from "heroui-native";
import { useState, type JSX } from "react";

import { FieldRow } from "@/components/field-row";
import { NumberField } from "@/components/number-field";
import { ReasonSelect } from "@/components/reason-select";
import { ScrollScreen } from "@/components/screen";
import { ErrorView, InlineError, LoadingView } from "@/components/state-view";
import { useAdjustStock, useCreateWriteoff, useProductDetail } from "@/hooks/use-products";
import { useCurrentUser } from "@/hooks/use-session";

/**
 * Stock count (opname) for one product: type what is on the shelf, see the
 * difference against the system, and settle it.
 *
 * - Admin: the count becomes the new stock (`PUT /products/{id}` with `stock`
 *   replaced — the only endpoint that can do it). Explaining a shortfall with a
 *   reason turns it into a write-off instead, which leaves an audit row.
 * - Kasir: a shortfall can only be settled as a damaged/expired write-off; a
 *   surplus needs an admin. Both rules live in `@kasir/shared` `resolveStockCount`
 *   and are enforced again by the server.
 */
export default function StockCountScreen(): JSX.Element {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const product = useProductDetail(Number(rawId));
  const adjust = useAdjustStock();
  const writeoff = useCreateWriteoff();

  if (product.isPending) return <LoadingView />;
  if (product.isError) {
    return (
      <ScrollScreen>
        <ErrorView error={product.error} onRetry={() => void product.refetch()} />
      </ScrollScreen>
    );
  }

  const isPending = adjust.isPending || writeoff.isPending;

  return (
    <CountForm
      product={product.data}
      role={user.role}
      isPending={isPending}
      error={adjust.error ?? writeoff.error}
      onAdjust={(countedStock) =>
        adjust.mutate({ product: product.data, countedStock }, { onSuccess: () => router.back() })
      }
      onWriteoff={(quantity, reason) =>
        writeoff.mutate(
          {
            product: product.data,
            input: { productId: product.data.id, quantity, reason, notes: id.stock.count },
          },
          { onSuccess: () => router.back() }
        )
      }
    />
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
      <Typography.Heading type="h4">{product.name}</Typography.Heading>
      <Typography type="body-sm" color="muted">
        {id.stock.countDescription}
      </Typography>

      <FieldRow
        label={id.stock.systemLabel}
        value={`${formatNumber(product.stock)} ${product.unit}`}
      />

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

      {shortfall ? (
        <ReasonSelect
          reasons={reasons}
          value={reason}
          onChange={setReason}
          description={role === "admin" ? undefined : id.stock.lostAdminOnly}
        />
      ) : null}

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

      <Button isDisabled={!canSubmit || isPending} onPress={submit}>
        {isPending ? <Spinner size="sm" /> : <Button.Label>{submitLabel}</Button.Label>}
      </Button>
    </ScrollScreen>
  );
}
