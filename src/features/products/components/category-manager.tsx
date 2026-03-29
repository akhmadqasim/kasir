import { useState } from "react"
import { Pencil, Trash2, Plus, Check, X } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "../hooks/use-categories"
import type { Category } from "../types"

interface CategoryManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CategoryManager({ open, onOpenChange }: CategoryManagerProps) {
  const user = useAuthStore((s) => s.user)
  const { data: categories } = useCategories()
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const deleteCategory = useDeleteCategory()

  const [newName, setNewName] = useState("")
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editName, setEditName] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

  const handleCreate = () => {
    if (!newName.trim()) return
    createCategory.mutate(
      { name: newName.trim(), callerId: user!.id },
      { onSuccess: () => setNewName("") }
    )
  }

  const handleStartEdit = (category: Category) => {
    setEditingCategory(category)
    setEditName(category.name)
  }

  const handleSaveEdit = () => {
    if (!editingCategory || !editName.trim()) return
    updateCategory.mutate(
      { id: editingCategory.id, name: editName.trim(), callerId: user!.id },
      { onSuccess: () => setEditingCategory(null) }
    )
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteCategory.mutate(
      { id: deleteTarget.id, callerId: user!.id },
      { onSettled: () => setDeleteTarget(null) }
    )
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{id.products.manageCategories}</SheetTitle>
            <SheetDescription>
              Tambah, edit, atau hapus kategori produk
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-6 overflow-hidden px-4">
            {/* Add category form */}
            <div className="grid gap-3">
              <Label htmlFor="new-category">{id.products.addCategory}</Label>
              <div className="flex gap-2">
                <Input
                  id="new-category"
                  placeholder={id.products.categoryName}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <Button
                  size="icon"
                  onClick={handleCreate}
                  disabled={!newName.trim() || createCategory.isPending}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Separator />

            {/* Category list */}
            <ScrollArea className="flex-1 -mx-4">
              <div className="grid gap-1 px-4">
                {categories?.map((category) => (
                  <div
                    key={category.id}
                    className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-accent"
                  >
                    {editingCategory?.id === category.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit()
                            if (e.key === "Escape") setEditingCategory(null)
                          }}
                          className="h-8 flex-1"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={handleSaveEdit}
                          disabled={!editName.trim() || updateCategory.isPending}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditingCategory(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-sm">
                          {category.name}
                        </span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleStartEdit(category)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeleteTarget(category)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {(!categories || categories.length === 0) && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Belum ada kategori
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>

          <SheetFooter>
            <p className="text-xs text-muted-foreground">
              {categories?.length ?? 0} kategori
            </p>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{id.common.confirm}</AlertDialogTitle>
            <AlertDialogDescription>
              {id.products.deleteCategoryConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{id.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {id.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
