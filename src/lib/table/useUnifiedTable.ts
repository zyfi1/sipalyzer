import { useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";

interface UseUnifiedTableOptions<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  initialSorting?: SortingState;
  initialColumnVisibility?: VisibilityState;
  initialPagination?: PaginationState;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  manualPagination?: boolean;
  manualSorting?: boolean;
  pageCount?: number;
  getRowId?: (row: TData, index: number, parent?: { id: string; index: number }) => string;
}

export function useUnifiedTable<TData>({
  data,
  columns,
  initialSorting = [],
  initialColumnVisibility = {},
  initialPagination = { pageIndex: 0, pageSize: 50 },
  pagination: controlledPagination,
  onPaginationChange,
  globalFilter,
  onGlobalFilterChange,
  manualPagination = false,
  manualSorting = false,
  pageCount,
  getRowId,
}: UseUnifiedTableOptions<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialColumnVisibility);
  const [pagination, setPagination] = useState<PaginationState>(initialPagination);
  const resolvedPagination = controlledPagination ?? pagination;
  const handlePaginationChange = onPaginationChange ?? setPagination;

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      pagination: resolvedPagination,
      ...(globalFilter !== undefined ? { globalFilter } : {}),
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: handlePaginationChange,
    ...(onGlobalFilterChange ? { onGlobalFilterChange } : {}),
    manualPagination,
    manualSorting,
    pageCount,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    ...(getRowId ? { getRowId } : {}),
  });

  return {
    table,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    columnVisibility,
    setColumnVisibility,
    pagination: resolvedPagination,
    setPagination: handlePaginationChange,
  };
}
