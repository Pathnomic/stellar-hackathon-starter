"use client"

/**
 * A list of entries a person can look through: search it, sort it, page by page.
 *
 * Tellop wrote this one. shadcn and ReUI both ship the parts it is made of -
 * `table`, `input`, `button`, `empty` next door - and neither ships the thing
 * made out of them, so `components/PROVENANCE.json` records this file under the
 * `tellop` source with no licence text beside it: a generated app belongs to the
 * person who made it, and Tellop claims nothing inside one.
 *
 * ## What it does, and what it deliberately does not
 *
 * Searching, sorting and paging all happen in the browser over the entries it
 * was handed. It asks for nothing: there is no request, no upload, no address
 * named anywhere in this file. An app with more entries than fit in one page
 * load should search and sort them on the server and hand this piece one page
 * at a time - the props below still describe that page honestly.
 *
 * ## Two things it needs from whoever uses it
 *
 * `columns` and `data` are better off keeping the same identity between renders
 * - module scope, `useMemo`, or a query result, rather than an array written
 * inline in the render. Everything shown is computed from them, so a fresh array
 * every render is a fresh computation every render. That is a cost and no longer
 * a trap: measured 2026-09-02, an inline `data` used to send a person reading
 * page three back to page one on any unrelated re-render of the page around
 * them. See "Which page a person is on" below for what replaced it.
 *
 * A definition is `{ accessorKey, header, cell }`, or `{ accessorFn, id, header,
 * cell }` where the value has to be worked out rather than read off a field -
 * measured, the search reaches both of those. What it cannot reach is a
 * display-only definition, which has no value to read.
 *
 * ## Which page a person is on
 *
 * Paging is left where the person put it, and goes back to the first page in
 * exactly three cases: the number of entries changed, `resetKey` changed, or the
 * search words changed. The machinery underneath would otherwise start again at
 * the first page every time `data` arrives as a new array, which for an app that
 * writes its entries inline is every single render - hence `autoResetPageIndex`
 * being off below, with the three honest cases done by hand instead. `resetKey`
 * is how an app says "these are different entries" when the count happens to be
 * the same: a chosen category, a chosen person, a chosen day.
 *
 * ## The words
 *
 * Every label is a prop with an English default, so an app that keeps its own
 * words passes its own. `pageLabel` is a function rather than a sentence with
 * holes in it, because the two numbers fall in a different order in different
 * languages.
 */

import * as React from "react"
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  InboxIcon,
  SearchIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/*
 * Registered once, outside the component: this is a description of which parts
 * of the machinery exist, not state, and building it inside the render would
 * rebuild the whole pipeline on every keystroke.
 */
const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})

/** What a heading looks like when it can be sorted, and how it is sorted now. */
function SortMark({ direction }) {
  if (direction === "asc") return <ArrowUpIcon aria-hidden="true" />
  if (direction === "desc") return <ArrowDownIcon aria-hidden="true" />
  return <ArrowUpDownIcon aria-hidden="true" className="opacity-50" />
}

/** What a browser reads out for a heading that is sorted one way or the other. */
function sortedAs(direction) {
  if (direction === "asc") return "ascending"
  if (direction === "desc") return "descending"
  return "none"
}

function DataTable({
  columns,
  data,
  resetKey,
  searchPlaceholder = "Search…",
  emptyTitle = "Nothing here yet",
  emptyDescription = "Whatever you add shows up here.",
  noMatchTitle = "Nothing found",
  noMatchDescription = "Try fewer words.",
  previousLabel = "Previous",
  nextLabel = "Next",
  pageLabel = (page, pages) => `Page ${page} of ${pages}`,
  pageSize = 10,
  className,
}) {
  /*
   * The starting page size only. Handing a new one later does not move a person
   * who is already three pages in, which is the behaviour we want and also what
   * the machinery underneath guarantees.
   */
  const initialState = React.useMemo(
    () => ({ pagination: { pageIndex: 0, pageSize } }),
    [pageSize],
  )
  const table = useTable({
    features,
    columns,
    data,
    initialState,
    /*
     * Off, because the machinery watches `data`'s identity rather than what is
     * in it: a fresh array carrying the very same entries counted as a change,
     * and paging started over. The three cases that genuinely mean "start
     * again" are done deliberately - just below, and beside the search field.
     */
    autoResetPageIndex: false,
  })

  /*
   * More entries, fewer entries, or an app saying outright that these are
   * different ones. Counting rather than comparing identity is the whole point:
   * `data.length` moves when the entries really did.
   */
  const entryCount = Array.isArray(data) ? data.length : 0
  const paging = React.useRef({ entryCount, resetKey })
  React.useEffect(() => {
    if (paging.current.entryCount === entryCount && paging.current.resetKey === resetKey) {
      return
    }
    paging.current = { entryCount, resetKey }
    table.setPageIndex(0)
  }, [entryCount, resetKey, table])

  const searchText = table.state.globalFilter ?? ""
  const shown = table.getRowModel().rows
  const pages = Math.max(table.getPageCount(), 1)
  const page = table.state.pagination.pageIndex + 1
  const across = Math.max(table.getAllLeafColumns().length, 1)

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <SearchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <Input
          value={searchText}
          onValueChange={(next) => {
            table.setGlobalFilter(next)
            // The words decide what there is to page through, so the first page
            // is the only place it makes sense to be standing afterwards.
            table.setPageIndex(0)
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="max-w-xs"
        />
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const direction = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={sortable ? sortedAs(direction) : undefined}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2.5"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <SortMark direction={direction} />
                      </Button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {shown.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={across} className="p-0">
                <Empty className="border-0 py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {searchText === "" ? (
                        <InboxIcon aria-hidden="true" />
                      ) : (
                        <SearchIcon aria-hidden="true" />
                      )}
                    </EmptyMedia>
                    <EmptyTitle>
                      {searchText === "" ? emptyTitle : noMatchTitle}
                    </EmptyTitle>
                    <EmptyDescription>
                      {searchText === "" ? emptyDescription : noMatchDescription}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : (
            shown.map((entry) => (
              <TableRow key={entry.id}>
                {entry.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {pageLabel(page, pages)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              {previousLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {nextLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { DataTable }
