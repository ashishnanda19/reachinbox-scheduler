import type { Editor } from '@tiptap/core';
import {
  AlignCenter,
  AlignStartVertical,
  Bold,
  ChevronsUpDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useReducer, useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { Popover } from '../ui/Popover';

const SIZES = [
  { label: 'Small', value: '13px' },
  { label: 'Normal', value: '16px' },
  { label: 'Large', value: '20px' },
  { label: 'Huge', value: '28px' },
];
const SPACINGS = ['1', '1.5', '2'];

/** The "Tt" icon: a big T with a small t. */
function TextSizeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6V4h10v2M7 4v13M5 17h4" />
      <path d="M13 11V9.5h7V11M16.5 9.5V17M15.2 17h2.6" />
    </svg>
  );
}

interface ToolProps {
  left: number;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  width?: number;
}

// Tools sit at the exact x positions of the design, measured from the toolbar's left edge.
function Tool({ left, label, active, disabled, onClick, children, width = 45 }: ToolProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ left: left - width / 2, width }}
      className={cn(
        'absolute top-0 flex h-[45px] items-center justify-center text-ink-soft transition hover:text-ink-strong disabled:cursor-default',
        active && 'text-brand-text',
      )}
    >
      {children}
    </button>
  );
}

const Separator = ({ left }: { left: number }) => <span style={{ left }} className="absolute top-[10px] h-[25px] w-px bg-[#E8EAE8]" aria-hidden />;

export function EditorToolbar({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [menu, setMenu] = useState<'size' | 'spacing' | null>(null);

  // Re-render on every selection/content change so active states stay in sync.
  useEffect(() => {
    editor.on('transaction', rerender);
    return () => void editor.off('transaction', rerender);
  }, [editor]);

  const chain = () => editor.chain().focus();
  const icon = (Icon: typeof Bold) => <Icon size={22} strokeWidth={1.5} />;

  return (
    <div className="relative h-[45px] w-[1120px] rounded-full bg-white">
      <Tool left={26} label="Undo" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>{icon(Undo2)}</Tool>
      <Tool left={71} label="Redo" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>{icon(Redo2)}</Tool>
      <Separator left={101} />

      <div className="absolute left-[116px] top-0">
        <button
          type="button"
          aria-label="Text size"
          title="Text size"
          aria-haspopup="menu"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu(menu === 'size' ? null : 'size')}
          className="flex h-[45px] w-[56px] items-center justify-center gap-[3px] text-ink-soft hover:text-ink-strong"
        >
          <TextSizeIcon />
          <ChevronsUpDown size={14} strokeWidth={1.5} />
        </button>
        <Popover open={menu === 'size'} onClose={() => setMenu(null)} className="left-0 top-[48px] w-[140px] rounded-xl p-[6px]">
          {SIZES.map(({ label, value }) => (
            <button
              key={label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (value === '16px') chain().unsetFontSize().run();
                else chain().setFontSize(value).run();
                setMenu(null);
              }}
              className="flex h-9 w-full items-center rounded-lg px-3 text-left text-[15px] hover:bg-field"
            >
              {label}
            </button>
          ))}
        </Popover>
      </div>
      <Separator left={187} />

      <Tool left={219} label="Bold" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}>{icon(Bold)}</Tool>
      <Tool left={264} label="Italic" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}>{icon(Italic)}</Tool>
      <Tool left={309} label="Underline" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}>{icon(Underline)}</Tool>
      <Separator left={340} />

      <Tool left={372} label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => chain().setTextAlign('center').run()}>{icon(AlignCenter)}</Tool>
      <div className="absolute top-0" style={{ left: 417 - 22 }}>
        <button
          type="button"
          aria-label="Line spacing"
          title="Line spacing"
          aria-haspopup="menu"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu(menu === 'spacing' ? null : 'spacing')}
          className="flex h-[45px] w-[44px] items-center justify-center text-ink-soft hover:text-ink-strong"
        >
          <ChevronsUpDown size={22} strokeWidth={1.5} />
        </button>
        <Popover open={menu === 'spacing'} onClose={() => setMenu(null)} className="left-0 top-[48px] w-[110px] rounded-xl p-[6px]">
          {SPACINGS.map((value) => (
            <button
              key={value}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                chain().setLineHeight(value).run();
                setMenu(null);
              }}
              className="flex h-9 w-full items-center rounded-lg px-3 text-left text-[15px] hover:bg-field"
            >
              {value}
            </button>
          ))}
        </Popover>
      </div>
      <Separator left={448} />

      <Tool left={480} label="Numbered list" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}>{icon(ListOrdered)}</Tool>
      <Tool left={525} label="Bullet list" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}>{icon(List)}</Tool>
      <Tool left={570} label="Indent" onClick={() => chain().indent().run()}>{icon(IndentIncrease)}</Tool>
      <Tool left={615} label="Outdent" onClick={() => chain().outdent().run()}>{icon(IndentDecrease)}</Tool>
      <Tool left={660} label="Quote" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>{icon(Quote)}</Tool>
      <Tool left={705} label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => chain().setTextAlign('left').run()}>{icon(AlignStartVertical)}</Tool>
      <Separator left={737} />

      <Tool left={769} label="Strikethrough" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}>{icon(Strikethrough)}</Tool>
    </div>
  );
}
