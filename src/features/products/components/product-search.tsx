import { useState, useEffect } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { id } from "@/i18n/id"
import { useCategories } from "../hooks/use-categories"

interface ProductSearchProps {
  onSearchChange: (query: string) => void
  onCategoryChange: (categoryId: number | null) => void
}

export function ProductSearch({ onSearchChange, onCategoryChange }: ProductSearchProps) {
  const [searchInput, setSearchInput] = useState("")
  const { data: categories } = useCategories()

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChange(searchInput)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, onSearchChange])

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={id.products.search}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select
        onValueChange={(value) => {
          onCategoryChange(value === "all" ? null : Number(value))
        }}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder={id.products.allCategories} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{id.products.allCategories}</SelectItem>
          {categories?.map((cat) => (
            <SelectItem key={cat.id} value={String(cat.id)}>
              {cat.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
