import { useState } from "react"
import { Pencil, Trash2, Plus, Check, X } from "lucide-react"
import { AlertDialog, Button, Drawer, Input, Label, ScrollShadow, TextField } from "@heroui/react"

import { NoData } from "@/components/no-data"
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
            </Drawer.Header>

            {/* `Drawer.Body` menggulir isinya sendiri. Di sini gulirannya
                dimatikan supaya formulir tambah tetap menempel di atas dan hanya
                daftarnya yang bergerak, sama seperti sebelum pindah dari Sheet. */}
            <Drawer.Body className="flex flex-col gap-6 overflow-hidden">
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
                    <Plus />
                  </Button>
                </div>
              </TextField>

              <ScrollShadow className="-mx-4 min-h-0 flex-1">
                <div className="grid gap-1 px-4">
                  {categories?.map((category) => (
                    <div
                      key={category.id}
                      className="flex min-h-9 items-center gap-2 rounded-2xl px-2 py-1 hover:bg-default"
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
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit()
                                if (e.key === "Escape") setEditingCategory(null)
                              }}
                            />
                          </TextField>
                          <Button
                            aria-label={id.common.save}
                            isDisabled={!editName.trim() || updateCategory.isPending}
                            isIconOnly
                            size="sm"
                            onPress={handleSaveEdit}
                          >
                            <Check />
                          </Button>
                          <Button
                            aria-label={id.common.cancel}
                            isIconOnly
                            size="sm"
                            variant="tertiary"
                            onPress={() => setEditingCategory(null)}
                          >
                            <X />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 truncate text-foreground">{category.name}</span>
                          {/* Aksi baris mengikuti contoh "Custom Cells" tabel HeroUI:
                              `tertiary` untuk ubah, `danger-soft` untuk hapus, dan
                              selalu terlihat — layar ini juga dibuka dari tablet,
                              yang tidak punya hover. */}
                          <div className="flex items-center gap-1">
                            <Button
                              aria-label={`${id.common.edit} ${category.name}`}
                              isIconOnly
                              size="sm"
                              variant="tertiary"
                              onPress={() => handleStartEdit(category)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              aria-label={`${id.common.delete} ${category.name}`}
                              isIconOnly
                              size="sm"
                              variant="danger-soft"
                              onPress={() => setDeleteTarget(category)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {(!categories || categories.length === 0) && (
                    <NoData title="Belum ada kategori" />
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
              <p>{id.products.deleteCategoryConfirm}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
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
