"use client"

/**
 * A place to drop files, or to choose them - and the list of what was chosen.
 *
 * Tellop wrote this one, and it had to be written rather than vendored: neither
 * shadcn's registry nor ReUI has a file-upload piece (measured at qualification
 * time). It is
 * recorded in `components/PROVENANCE.json` under the `tellop` source with no
 * licence text beside it, because a generated app belongs to the person who made
 * it and Tellop claims nothing inside one.
 *
 * ## It never sends anything anywhere
 *
 * The name says "upload" because that is what a person calls it; this piece does
 * not do it. There is no request, no address and no progress here. It collects
 * what a person picked and hands the app a plain `File[]` through `onFiles`,
 * every time the list changes - and the app decides what happens next. That is
 * deliberate: where the files go, whether they go at all, what is allowed and
 * who may do it are all the app's own decisions, and a piece of the kit is the
 * wrong place to have made them.
 *
 * ## The one raw control, named
 *
 * `<input type="file">` is written here by hand. There is no kit piece for it
 * and there cannot be a useful one: opening the operating system's own file
 * chooser is something only that element does. It is the only raw form control
 * in this file, it is hidden from sight and from the tab order, and the kit
 * button beside it is what a person actually presses.
 *
 * ## What happens to a file it will not take
 *
 * A drop is not filtered by the browser the way the file chooser is, so a person
 * can drop the wrong kind of file, or more files than this was told to hold.
 * Both used to happen in total silence - the file simply was not there
 * afterwards, with nothing on the page to say why (measured 2026-09-02). Now the
 * piece says one plain line, and hands the app the same fact through
 * `onRejected({ files, reason })`, where the reason is `"type"` for a kind this
 * was not asked to take and `"count"` for the ones past `maxFiles`. A drop that
 * trips both is two calls and two lines. The line clears the next time a file is
 * actually added.
 *
 * ## The words
 *
 * Every label is a prop with an English default, so an app that keeps its own
 * words passes its own.
 */

import * as React from "react"
import { PaperclipIcon, UploadIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"

/**
 * Does this file match what `accept` asked for?
 *
 * The browser applies `accept` to the file chooser and to nothing else - a file
 * dropped onto a page arrives whatever it is - so a drop zone that says
 * "pictures" and quietly takes anything is a drop zone that lies. This is the
 * same three shapes the attribute itself allows: a suffix (`.pdf`), a whole
 * family (`image/*`) and one exact kind (`application/pdf`).
 */
function allowed(file, accept) {
  if (typeof accept !== "string" || accept.trim() === "") return true
  const kind = (file.type ?? "").toLowerCase()
  const name = (file.name ?? "").toLowerCase()
  return accept
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "")
    .some((entry) => {
      if (entry.startsWith(".")) return name.endsWith(entry)
      if (entry.endsWith("/*")) return kind.startsWith(entry.slice(0, -1))
      return kind === entry
    })
}

/** How big it is, in the units a person reads rather than in bytes. */
function sizeOf(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Two picks of the same file are one file. */
function keyOf(file) {
  return `${file.name}:${String(file.size)}:${String(file.lastModified)}`
}

/** Nothing was turned away - one stable value, so an unchanged state stays unchanged. */
const NOTHING_REFUSED = Object.freeze([])

function FileUpload({
  accept,
  multiple = false,
  maxFiles = multiple ? Number.POSITIVE_INFINITY : 1,
  onFiles,
  onRejected,
  label = "Drop files here, or choose them",
  hint,
  chooseLabel = "Choose files",
  removeLabel = "Remove",
  rejectedLabel = "Some of those files are not a kind this accepts, so they were left out.",
  tooManyLabel = "That is more files than this takes, so the extra ones were left out.",
  className,
}) {
  const chooser = React.useRef(null)
  /*
   * The list and what was turned away are one value, because they are decided
   * together: whether a file was too many to fit can only be worked out against
   * the list as it stood a moment ago.
   */
  const [picked, setPicked] = React.useState({
    files: [],
    refused: NOTHING_REFUSED,
  })
  const [hovering, setHovering] = React.useState(false)

  /*
   * Worked out from `prev` rather than from the list this render happens to be
   * holding. Measured 2026-09-02 before it was: two adds in one go - a drop
   * landing while a pick was still settling - and the first one was gone,
   * because both had read the same empty list out of the closure around them.
   */
  const take = (incoming) => {
    const arriving = Array.from(incoming)
    if (arriving.length === 0) return
    setPicked((prev) => {
      const fit = arriving.filter((file) => allowed(file, accept))
      const wrongKind = arriving.filter((file) => !allowed(file, accept))
      const refused = []
      if (wrongKind.length > 0) refused.push({ reason: "type", files: wrongKind })

      // Nothing arrived that could be kept, so whatever was already chosen stays
      // exactly as it was - a refused drop must never empty the list.
      if (fit.length === 0) return { files: prev.files, refused }

      const room = multiple ? maxFiles : 1
      const kept = multiple ? prev.files : []
      const seen = new Set(kept.map(keyOf))
      const together = [...kept, ...fit.filter((file) => !seen.has(keyOf(file)))]
      const overflowed = together.slice(room)
      if (overflowed.length > 0) refused.push({ reason: "count", files: overflowed })

      return {
        files: together.slice(0, room),
        refused: refused.length === 0 ? NOTHING_REFUSED : refused,
      }
    })
  }

  /*
   * The app is told from here rather than from inside the updater above,
   * because a state updater has to be a plain computation - React is free to
   * run it more than once - and telling an app about its files is not that. One
   * run per render, so two adds settled together are one report carrying the
   * whole resulting list.
   */
  const told = React.useRef(picked)
  React.useEffect(() => {
    const previously = told.current
    told.current = picked
    if (previously.files !== picked.files) onFiles?.(picked.files)
    if (previously.refused !== picked.refused) {
      for (const refusal of picked.refused) onRejected?.(refusal)
    }
  }, [picked, onFiles, onRejected])

  const drop = (event) => {
    event.preventDefault()
    setHovering(false)
    take(event.dataTransfer.files)
  }

  const remove = (file) => {
    setPicked((prev) => ({
      files: prev.files.filter((entry) => keyOf(entry) !== keyOf(file)),
      refused: prev.refused,
    }))
  }

  const chosen = picked.files

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div
        data-hovering={hovering ? "true" : undefined}
        onDragOver={(event) => {
          event.preventDefault()
          setHovering(true)
        }}
        onDragLeave={() => setHovering(false)}
        onDrop={drop}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2.5 rounded-lg",
          "border border-dashed border-input bg-transparent px-4 py-8 text-center transition-colors",
          "data-hovering:border-ring data-hovering:bg-muted/50",
        )}
      >
        <UploadIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        <p className="text-sm text-foreground">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        <Button variant="outline" size="sm" onClick={() => chooser.current?.click()}>
          {chooseLabel}
        </Button>
        {/*
          The one raw control, explained in this file's opening comment. Hidden
          from sight and taken out of the tab order so the button above is the
          only way in - two ways to do the same thing is two things to explain.
        */}
        <input
          ref={chooser}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            take(event.target.files)
            // Cleared so that picking the same file twice in a row is still a
            // change the browser tells us about.
            event.target.value = ""
          }}
        />
      </div>

      {/*
        Always here, so a reader is told when a line appears in it rather than
        being told about a region that has only just come into being. `empty:`
        keeps it out of the way - and out of the gap - while it holds nothing.
      */}
      <div role="status" className="flex flex-col gap-1 empty:hidden">
        {picked.refused.map((refusal) => (
          <p key={refusal.reason} className="text-sm text-destructive">
            {refusal.reason === "type" ? rejectedLabel : tooManyLabel}
          </p>
        ))}
      </div>

      {chosen.length > 0 ? (
        <ItemGroup className="gap-1.5">
          {chosen.map((file) => (
            <Item key={keyOf(file)} variant="outline" size="sm">
              <ItemMedia variant="icon">
                <PaperclipIcon aria-hidden="true" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="truncate">{file.name}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">{sizeOf(file.size)}</Badge>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${removeLabel}: ${file.name}`}
                  title={removeLabel}
                  onClick={() => remove(file)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : null}
    </div>
  )
}

export { FileUpload }
