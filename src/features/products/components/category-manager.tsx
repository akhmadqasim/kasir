import { useState } from "react"
import { Pencil, Trash2, Plus, Check, X } from "lucide-react"
import {
  AlertDialog,
  Button,
  Drawer,
  Input,
  Label,
  ScrollShadow,
  Separator,
  TextField,
} from "@heroui/react"

import { id } from "@/i18n/id"
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
    createCategory.mutate({ name: newName.trim() }, { onSuccess: () => setNewName("") })
  }

  const handleStartEdit = (category: Category) => {
    setEditingCategory(category)
    setEditName(category.name)
  }

  const handleSaveEdit = () => {
    if (!editingCategory || !editName.trim()) return
    updateCategory.mutate(
      { id: editingCategory.id, name: editName.trim() },
      { onSuccess: () => setEditingCategory(null) },
    )
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteCategory.mutate(deleteTarget.id, {
      onSettled: () => setDeleteTarget(null),
    })
  }

  return (
    <>
      <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
        <Drawer.Content placement="right">
          <Drawer.Dialog aria-label={id.products.manageCategories}>
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>{id.products.manageCategories}</Drawer.Heading>
              <p className="text-sm text-muted">Tambah, edit, atau hapus kategori produk</p>
            </Drawer.Header>

            {/* `Drawer.Body` menggulir isinya sendiri. Di sini gulirannya
                dimatikan supaya formulir tambah tetap menempel di atas dan hanya
                daftarnya yang bergerak, sama seperti sebelum pindah dari Sheet. */}
            <Drawer.Body className="flex flex-col gap-6 overflow-hidden text-foreground">
              <TextField
                fullWidth
                isDisabled={createCategory.isPending}
                value={newName}
                onChange={setNewName}
              >
                <Label>{id.products.addCategory}</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder={id.products.categoryName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate()
                    }}
                  />
                  <Button
                    aria-label={id.products.addCategory}
                    isDisabled={!newName.trim() || createCategory.isPending}
                    isIconOnly
                    onPress={handleCreate}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </TextField>

              <Separator />

              <ScrollShadow className="-mx-4 min-h-0 flex-1">
                <div className="grid gap-1 px-4">
                  {categories?.map((category) => (
                    <div
                      key={category.id}
                      className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-default"
                    >
                      {editingCategory?.id === category.id ? (
                        <>
                          <TextField
                            aria-label={`${id.common.edit} ${category.name}`}
                            className="flex-1"
                            isDisabled={updateCategory.isPending}
                            value={editName}
                            onChange={setEditName}
                          >
                            <Input
                              autoFocus
                              className="h-8"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit()
                                if (e.key === "Escape") setEditingCategory(null)
                              }}
                            />
                          </TextField>
                          <Button
                            aria-label={id.common.save}
                            className="h-8 w-8"
                            isDisabled={!editName.trim() || updateCategory.isPending}
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            onPress={handleSaveEdit}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={id.common.cancel}
                            className="h-8 w-8"
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            onPress={() => setEditingCategory(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 truncate text-sm">{category.name}</span>
                          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <Button
                              aria-label={`${id.common.edit} ${category.name}`}
                              className="h-7 w-7"
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() => handleStartEdit(category)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              aria-label={`${id.common.delete} ${category.name}`}
                              className="h-7 w-7"
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() => setDeleteTarget(category)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-danger" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {(!categories || categories.length === 0) && (
                    <p className="py-8 text-center text-sm text-muted">Belum ada kategori</p>
                  )}
                </div>
              </ScrollShadow>
            </Drawer.Body>

            <Drawer.Footer>
              <p className="text-xs text-muted">{categories?.length ?? 0} kategori</p>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.common.confirm}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.common.confirm}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">{id.products.deleteCategoryConfirm}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="outline" onPress={() => setDeleteTarget(null)}>
                {id.common.cancel}
              </Button>
              <Button variant="danger" onPress={handleDelete}>
                {id.common.delete}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}
