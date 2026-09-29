"use client"

/**
 * A writing area with a few formatting controls, over Tiptap 3.
 *
 * Tellop wrote this file; Tiptap wrote the machinery under it. It is recorded in
 * `components/PROVENANCE.json` under the `tellop` source with no licence text
 * beside it, because a generated app belongs to the person who made it and
 * Tellop claims nothing inside one. Tiptap's own packages are ordinary
 * dependencies, pinned in `package.json` and covered by the lockfile.
 *
 * ## No markup is written here, and no exemption is claimed
 *
 * Tiptap owns a `contenteditable` element: `EditorContent` mounts one and the
 * library writes into it directly. **This wrapper contains no
 * `dangerouslySetInnerHTML`**, so the vendored-kit gate needs no exemption for
 * this file and grants it none. The one reviewed exemption that gate carries is
 * `chart.jsx`'s, for the `<style>` element a figure builds out of its own
 * colours. Nothing in this file turns a string into markup.
 *
 * ## Nothing leaves the browser
 *
 * `StarterKit` and nothing else. No cloud extension, no collaboration
 * extension, no AI extension: none of them is in `package.json`, so none of
 * them can be reached from here. There is no request, no socket and no address
 * anywhere in this file. What a person writes stays in the browser until the
 * app that mounted this piece does something with it.
 *
 * ## What `onChange` is handed, and how to show it again
 *
 * `onChange` receives the writing as an HTML string, which is the shape an app
 * stores. To show it again later, mount this same piece with `editable={false}`
 * - never by putting the stored string into a page as markup, which is exactly
 * what the kit's rules forbid and what this piece exists to make unnecessary.
 *
 * ## `content` and `editable` keep working after the first paint
 *
 * Tiptap builds its editor once and then keeps both of those in state of its
 * own, so handing a new value later changes nothing unless somebody tells the
 * editor - which the two effects below do, and which is why they exist. Measured
 * 2026-09-02, before they did: flipping `editable` to `false` took the controls
 * away while the writing area stayed `contenteditable="true"`, and writing
 * fetched a beat after the first paint never appeared at all.
 *
 * `onChange` still reports the person's own editing and nothing else: setting
 * `content` from a prop is done with `emitUpdate: false`, so an app that stores
 * what `onChange` gives it cannot be sent round in a circle by its own save.
 *
 * ## The words
 *
 * `placeholder` and every control's name are props with English defaults, so an
 * app that keeps its own words passes its own.
 */

import * as React from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  BoldIcon,
  Heading2Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  StrikethroughIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/**
 * The controls, in the order they are drawn.
 *
 * Each one says how to tell whether it is on and what to do when it is pressed.
 * Both read the live editor, so the marks light up as the caret moves - which is
 * why `useEditorState` below exists: a Tiptap 3 editor does not re-render its
 * surroundings on every change, on purpose.
 */
const TOOLS = Object.freeze([
  Object.freeze({
    name: "bold",
    Mark: BoldIcon,
    isOn: (editor) => editor.isActive("bold"),
    press: (editor) => editor.chain().focus().toggleBold().run(),
  }),
  Object.freeze({
    name: "italic",
    Mark: ItalicIcon,
    isOn: (editor) => editor.isActive("italic"),
    press: (editor) => editor.chain().focus().toggleItalic().run(),
  }),
  Object.freeze({
    name: "strike",
    Mark: StrikethroughIcon,
    isOn: (editor) => editor.isActive("strike"),
    press: (editor) => editor.chain().focus().toggleStrike().run(),
  }),
  Object.freeze({
    name: "bulletList",
    Mark: ListIcon,
    isOn: (editor) => editor.isActive("bulletList"),
    press: (editor) => editor.chain().focus().toggleBulletList().run(),
  }),
  Object.freeze({
    name: "orderedList",
    Mark: ListOrderedIcon,
    isOn: (editor) => editor.isActive("orderedList"),
    press: (editor) => editor.chain().focus().toggleOrderedList().run(),
  }),
  Object.freeze({
    name: "heading",
    Mark: Heading2Icon,
    isOn: (editor) => editor.isActive("heading", { level: 2 }),
    press: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  }),
])

const TOOL_NAMES = Object.freeze({
  bold: "Bold",
  italic: "Italic",
  strike: "Crossed out",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  heading: "Heading",
})

/** Nothing is selected yet - a stable value, so the group never goes uncontrolled. */
const NONE_ON = Object.freeze([])

/*
 * How the writing itself is drawn. Every one of these reads a name this app's
 * `tokens.css` defines: there is no colour, no radius and no font family written
 * here, which is the same rule the rest of the kit obeys.
 */
const WRITING_AREA =
  "min-h-40 w-full px-3 py-3 text-sm text-foreground outline-none " +
  "[&>*:first-child]:mt-0 [&_p]:mt-2 " +
  "[&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight " +
  "[&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mt-1 " +
  "[&_blockquote]:mt-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 " +
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs " +
  "[&_pre]:mt-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 " +
  "[&_hr]:my-4 [&_hr]:border-border " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4"

/**
 * Is there nothing written yet?
 *
 * Asked of the plain starting value rather than of the editor, because the
 * editor does not exist during the first paint (`immediatelyRender: false` is
 * what keeps this piece from breaking a page rendered on the server). Without
 * this the placeholder would appear a beat after everything else.
 */
function looksEmpty(content) {
  if (content === undefined || content === null) return true
  if (typeof content !== "string") return false
  return content.replace(/<[^>]*>/g, "").trim() === ""
}

function Editor({
  content,
  onChange,
  placeholder = "Write something…",
  toolNames = TOOL_NAMES,
  editable = true,
  className,
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    editable,
    // A page rendered on the server has no browser to mount into. Rendering
    // straight away there is the one way this piece can break a page it is on.
    immediatelyRender: false,
    editorProps: { attributes: { class: WRITING_AREA } },
    onUpdate: ({ editor: current }) => {
      onChange?.(current.getHTML())
    },
  })

  /*
   * `editable` above is a starting value. Tiptap keeps the real one in its own
   * state and re-applies it, so this is the only way to change it once the
   * editor exists - without it, `editable={false}` hid the controls and left the
   * writing area editable.
   *
   * The `false` is not decoration: `setEditable` announces an update by default,
   * and the app would read that as the person having written something. Measured
   * with it left out - `onChange` fired the moment this piece appeared, carrying
   * the writing it had just been handed, and again on every flip.
   */
  React.useEffect(() => {
    if (editor === null || editor === undefined) return
    editor.setEditable(editable, false)
  }, [editor, editable])

  /*
   * `content` is a starting value too, and an app that fetches the writing hands
   * it over a beat after the first paint. Compared against the editor's own HTML
   * first, so an app that stores what `onChange` gave it and hands the same
   * string straight back does not have its caret thrown to the top on every
   * keystroke. An app that hands back a differently spelled but equivalent
   * string will: keep what `onChange` gave you, or hand this piece a value that
   * only changes when something other than the person changed it.
   */
  React.useEffect(() => {
    if (editor === null || editor === undefined) return
    if (content === undefined) return
    if (content === editor.getHTML()) return
    editor.commands.setContent(content, { emitUpdate: false })
  }, [editor, content])

  const live = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null
      return {
        on: TOOLS.filter((tool) => tool.isOn(current)).map((tool) => tool.name),
        empty: current.isEmpty,
      }
    },
  })

  const on = live?.on ?? NONE_ON
  const empty = live === null || live === undefined ? looksEmpty(content) : live.empty

  return (
    <div
      className={cn(
        "w-full rounded-lg border border-input bg-transparent",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
    >
      {editable ? (
        <ToggleGroup
          multiple
          value={on}
          className="w-full flex-wrap border-b border-border p-1"
        >
          {TOOLS.map((tool) => (
            <ToggleGroupItem
              key={tool.name}
              value={tool.name}
              size="sm"
              aria-label={toolNames[tool.name]}
              title={toolNames[tool.name]}
              disabled={editor === null}
              onPressedChange={() => {
                if (editor !== null) tool.press(editor)
              }}
            >
              <tool.Mark aria-hidden="true" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}

      <div className="relative">
        <EditorContent editor={editor} />
        {editable && empty ? (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-3 text-sm text-muted-foreground select-none"
          >
            {placeholder}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { Editor }
