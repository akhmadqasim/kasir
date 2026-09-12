import {
  Host,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  contentShape,
  font,
  foregroundStyle,
  listStyle,
  onAppear,
  onTapGesture,
  refreshable,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import {
  formatNumber,
  id,
  isLowStock,
  productRowSubtitle,
  roleLabel,
  type Product,
} from "@kasir/shared";
import { useThemeColor } from "heroui-native";
import type { JSX } from "react";

import type {
  NativeProductListProps,
  NativeSettingsListProps,
} from "@/components/native-list.types";

/** The muted grey UIKit uses for a row's second line, rather than a colour of ours. */
const SECONDARY = { type: "hierarchical", style: "secondary" } as const;

const FOOTNOTE = font({ textStyle: "footnote" });
const CAPTION = font({ textStyle: "caption" });

/**
 * Makes the whole row hit-testable.
 *
 * Without it a tap only registers over the text and the chevron; the Spacer
 * between them — most of a row's width — swallows it. This is the modifier's
 * own documented reason for existing.
 */
const WHOLE_ROW = contentShape(shapes.rectangle());

/**
 * The product list as a real SwiftUI `List`.
 *
 * `@expo/ui/swift-ui` ships inside Expo Go — `expo-router` depends on it — so
 * the phone in the shop gets UIKit's own inset-grouped list without a dev
 * client: the system's row insets, its hairlines inset to the text, its
 * rubber-banding and its pull-to-refresh, none of which a React Native drawing
 * gets exactly right. (There is no press highlight — that belongs to `Button`,
 * and `onTapGesture` on the row is what makes the whole row, chevron included,
 * one target.)
 *
 * Paging survives the move. SwiftUI has no `onEndReached`, but it does have
 * `onAppear` per row, and the last row appearing means the same thing.
 *
 * Search stays outside this view: `@expo/ui` exposes no `searchable` modifier,
 * so the field above the list is still HeroUI's, which is also how a docked
 * search bar behaves.
 */
export function NativeProductList({
  products,
  emphasizeStock,
  onSelect,
  onRefresh,
  onEndReached,
}: NativeProductListProps): JSX.Element {
  const danger = useThemeColor("danger");
  const lastId = products.at(-1)?.id;

  // `useViewportSizeMeasurement`: `style={{ flex: 1 }}` sizes the React Native
  // container, but the SwiftUI layout pass still needs a proposed size, and a
  // `List` is the case that prop documents.
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <List
        modifiers={[listStyle("insetGrouped"), refreshable(async () => void (await onRefresh()))]}
      >
        <Section>
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              emphasizeStock={emphasizeStock}
              dangerColor={danger}
              isLast={product.id === lastId}
              onSelect={onSelect}
              onEndReached={onEndReached}
            />
          ))}
        </Section>
      </List>
    </Host>
  );
}

interface ProductRowProps {
  product: Product;
  emphasizeStock: boolean;
  dangerColor: string;
  isLast: boolean;
  onSelect: (product: Product) => void;
  onEndReached: () => void;
}

function ProductRow({
  product,
  emphasizeStock,
  dangerColor,
  isLast,
  onSelect,
  onEndReached,
}: ProductRowProps): JSX.Element {
  const low = isLowStock(product);
  const subtitle = productRowSubtitle(product, emphasizeStock);

  return (
    <HStack
      spacing={12}
      alignment="center"
      modifiers={
        isLast
          ? [WHOLE_ROW, onTapGesture(() => onSelect(product)), onAppear(onEndReached)]
          : [WHOLE_ROW, onTapGesture(() => onSelect(product))]
      }
    >
      <VStack alignment="leading" spacing={2}>
        <Text>{product.name}</Text>
        <Text modifiers={[FOOTNOTE, foregroundStyle(SECONDARY)]}>{subtitle}</Text>
      </VStack>

      <Spacer />

      <VStack alignment="trailing" spacing={2}>
        <Text modifiers={low ? [foregroundStyle(dangerColor)] : []}>
          {formatNumber(product.stock)}
        </Text>
        <Text modifiers={[CAPTION, foregroundStyle(SECONDARY)]}>{product.unit}</Text>
      </VStack>

      <Image systemName="chevron.right" size={12} modifiers={[foregroundStyle(SECONDARY)]} />
    </HStack>
  );
}

/**
 * Pengaturan as a SwiftUI `List`: grouped sections, a chevron row that
 * navigates, static rows that do not, and a destructive row at the end — the
 * shape every Settings screen on the phone already has.
 */
export function NativeSettingsList({
  user,
  serverAuthority,
  appVersion,
  onChangeServer,
  onLogout,
  isLoggingOut,
}: NativeSettingsListProps): JSX.Element {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <List modifiers={[listStyle("insetGrouped")]}>
        <Section title={id.settings.server}>
          <HStack spacing={12} modifiers={[WHOLE_ROW, onTapGesture(onChangeServer)]}>
            <Image systemName="desktopcomputer" size={18} />
            <VStack alignment="leading" spacing={2}>
              <Text>{serverAuthority}</Text>
              <Text modifiers={[FOOTNOTE, foregroundStyle(SECONDARY)]}>{id.server.change}</Text>
            </VStack>
            <Spacer />
            <Image systemName="chevron.right" size={12} modifiers={[foregroundStyle(SECONDARY)]} />
          </HStack>
        </Section>

        <Section title={id.settings.account}>
          <HStack spacing={12}>
            <Image systemName="person.crop.circle" size={18} />
            <VStack alignment="leading" spacing={2}>
              <Text>{user.full_name}</Text>
              <Text modifiers={[FOOTNOTE, foregroundStyle(SECONDARY)]}>{user.username}</Text>
            </VStack>
            <Spacer />
          </HStack>
          <HStack>
            <Text>{id.settings.role}</Text>
            <Spacer />
            <Text modifiers={[foregroundStyle(SECONDARY)]}>{roleLabel(user.role)}</Text>
          </HStack>
        </Section>

        <Section title={id.settings.about}>
          <HStack>
            <Text>{id.settings.version}</Text>
            <Spacer />
            <Text modifiers={[foregroundStyle(SECONDARY)]}>{appVersion}</Text>
          </HStack>
        </Section>

        <Section>
          <HStack modifiers={isLoggingOut ? [] : [WHOLE_ROW, onTapGesture(onLogout)]}>
            <Text modifiers={[foregroundStyle(isLoggingOut ? SECONDARY : "red")]}>
              {id.auth.logout}
            </Text>
            <Spacer />
            {/* The row cannot be tapped twice — the gesture is gone while the
                request is in flight — but without this nothing says so. */}
            {isLoggingOut ? <ProgressView /> : null}
          </HStack>
        </Section>
      </List>
    </Host>
  );
}
