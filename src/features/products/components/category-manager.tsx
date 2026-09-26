import { useState } from "react"
import { Pencil, Trash2, Plus, Check, X, Tags } from "lucide-react"
import {
  AlertDialog,
  Button,
  Drawer,
  Input,
  Label,
  ScrollShadow,
  Skeleton,
  TextField,
} from "@heroui/react"

import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { PendingButton } from "@/components/pending-button"
import { id } from "@/i18n/id"
import { formatNumber } from "@/lib/format"
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
  const { data: categories, isLoading, isFetching, error, refetch } = useCategories()
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const deleteCategory = useDeleteCategory()

  const [newName, setNewName] = useState("")
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editName, setEditName] = useState("")
  // Target dan keadaan buka dipisah supaya isi konfirmasi tidak mengosong
  // selama animasi tutupnya.
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Drawer ini tidak dilepas saat ditutup (state-nya milik komponen ini), jadi
  // ketikan dan baris yang sedang disunting dibersihkan sendiri di sini —
  // membuka ulang tidak lagi menampilkan suntingan setengah jadi dari kemarin.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setNewName("")
      setEditingCategory(null)
    }
    onOpenChange(next)
  }

  const handleCreate = () => {
    if (!newName.trim() || createCategory.isPending) return
    createCategory.mutate({ name: newName.trim() }, { onSuccess: () => setNewName("") })
  }

  const handleStartEdit = (category: Category) => {
    setEditingCategory(category)
    setEditName(category.name)
  }

  const handleSaveEdit = () => {
    if (!editingCategory || !editName.trim() || updateCategory.isPending) return
    updateCategory.mutate(
      { id: editingCategory.id, name: editName.trim() },
      { onSuccess: () => setEditingCategory(null) },
    )
  }

  const handleRequestDelete = (category: Category) => {
    setDeleteTarget(category)
    setDeleteOpen(true)
  }

  const handleDelete = () => {
    if (!deleteTarget || deleteCategory.isPending) return
    deleteCategory.mutate(deleteTarget.id, {
      onSettled: () => setDeleteOpen(false),
    })
  }

  const renderList = () => {
    if (isLoading) {
      return (
        <div aria-busy="true" className="grid gap-2 px-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full rounded-xl" />
          ))}
        </div>
      )
    }
    if (error && !categories) {
      return (
        <LoadError
          isRetrying={isFetching}
          title={id.loadFailed.categories}
          onRetry={() => refetch()}
        >
          {error.message}
        </LoadError>
      )
    }
    if (!categories || categories.length === 0) {
      return (
        <NoData icon={<Tags />} title={id.empty.categories}>
          {id.empty.categoriesHint}
        </NoData>
      )
    }

    return (
      // `-mx-2` mengimbangi `px-2` baris: nama dan tombolnya segaris dengan
      // tepi kolom "Tambah Kategori" di atasnya, latar hover-nya tetap lega.
      <ul aria-label="Daftar kategori" className="-mx-2 grid gap-1">
        {categories.map((category) => (
          <li
            key={category.id}
            className="flex min-h-10 items-center gap-2 rounded-2xl px-2 py-1 hover:bg-default"
          >
            {editingCategory?.id === category.id ? (
              <>
                <TextField
                  aria-label={`${id.common.edit} ${category.name}`}
                  className="flex-1"
                  isDisabled={updateCategory.isPending}
                  value={editName}
                  variant="secondary"
                  onChange={setEditName}
                >
                  <Input
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit()
                      if (e.key === "Escape") {
                        // Esc hanya membatalkan suntingan barisnya; tanpa ini
                        // tekanan yang sama juga menutup seluruh drawer.
                        e.stopPropagation()
                        setEditingCategory(null)
                      }
                    }}
                  />
                </TextField>
                <PendingButton
                  aria-label={`${id.common.save} ${category.name}`}
                  isDisabled={!editName.trim()}
                  isIconOnly
                  isPending={updateCategory.isPending}
                  size="sm"
                  onPress={handleSaveEdit}
                >
                  {updateCategory.isPending ? null : <Check />}
                </PendingButton>
                <Button
                  aria-label={`Batal ubah ${category.name}`}
                  isDisabled={updateCategory.isPending}
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
                <span className="flex-1 truncate text-sm text-foreground">{category.name}</span>
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
                    onPress={() => handleRequestDelete(category)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <Drawer.Backdrop isOpen={open} onOpenChange={handleOpenChange}>
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
                variant="secondary"
                onChange={setNewName}
              >
                <Label>{id.products.addCategory}</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder="Contoh: Minuman"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate()
                    }}
                  />
                  <PendingButton
                    aria-label={id.products.addCategory}
                    isDisabled={!newName.trim()}
                    isIconOnly
                    isPending={createCategory.isPending}
                    onPress={handleCreate}
                  >
                    {createCategory.isPending ? null : <Plus />}
                  </PendingButton>
                </div>
              </TextField>

              <ScrollShadow className="-mx-4 min-h-0 flex-1">
                <div className="px-4">{renderList()}</div>
              </ScrollShadow>
            </Drawer.Body>

            <Drawer.Footer>
              <p className="text-xs text-muted tabular-nums">
                {formatNumber(categories?.length ?? 0)} kategori
              </p>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>
                Hapus kategori {deleteTarget ? `"${deleteTarget.name}"` : ""}?
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{id.products.deleteCategoryConfirm}</p>
              <p>Kategori yang masih dipakai produk tidak bisa dihapus.</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={deleteCategory.isPending} slot="close" variant="tertiary">
                {id.common.cancel}
              </Button>
              <PendingButton
                isPending={deleteCategory.isPending}
                variant="danger"
                onPress={handleDelete}
              >
                {id.common.delete}
              </PendingButton>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}
