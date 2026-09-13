import { id } from "@kasir/shared";
import { SearchField } from "heroui-native";
import { useState, type JSX } from "react";

import { PageHeader } from "@/components/page-header";
import { ProductList } from "@/components/product-list";
import { Screen } from "@/components/screen";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useProductSearch } from "@/hooks/use-products";

/** Searchable product list: name, barcode or SKU, 300 ms debounce, 50 per page. */
export default function ProductsTab(): JSX.Element {
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 300);
  const result = useProductSearch({ query });

  return (
    <Screen>
      <ProductList
        result={result}
        header={
          <>
            <PageHeader title={id.products.title} />
            <SearchField value={search} onChange={setSearch}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder={id.products.search}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </>
        }
        emptyMessage={query ? id.products.noResults : id.products.noProducts}
      />
    </Screen>
  );
}
