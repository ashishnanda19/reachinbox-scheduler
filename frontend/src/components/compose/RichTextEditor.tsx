import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect } from 'react';
import { EditorToolbar } from './EditorToolbar';
import { FontSize } from './extensions/fontSize';
import { Indent } from './extensions/indent';
import { LineHeight } from './extensions/lineHeight';

interface RichTextEditorProps {
  onChange: (html: string, isEmpty: boolean) => void;
  onBlur?: () => void;
}

/** The 1156x527 editor container: placeholder line, white pill toolbar, then the editable area. */
export function RichTextEditor({ onChange, onBlur }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }),
      Underline,
      TextStyle,
      FontSize,
      LineHeight,
      Indent,
      TextAlign.configure({ types: ['paragraph'] }),
    ],
    content: '',
    editorProps: { attributes: { class: 'email-editor', 'aria-label': 'Message body' } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.isEmpty),
    onBlur: () => onBlur?.(),
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  return (
    <div className="relative h-[524px] w-full rounded-[14px] bg-editor">
      {editor?.isEmpty && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => editor.chain().focus().run()}
          className="absolute left-[17px] top-[17px] h-[22px] cursor-text text-left text-[17px] leading-[22px] text-ink-placeholder"
        >
          Type Your Reply...
        </button>
      )}
      <div className="absolute left-[18px] top-[63px]">{editor && <EditorToolbar editor={editor} />}</div>
      <EditorContent editor={editor} className="absolute inset-x-[18px] bottom-4 top-[122px] overflow-y-auto" />
    </div>
  );
}
