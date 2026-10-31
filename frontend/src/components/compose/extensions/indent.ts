import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

const STEP_PX = 24;
const MAX_STEPS = 8;

/**
 * Indent / outdent. Inside a list it nests the item (sink/lift); elsewhere it moves the paragraph by a
 * 24px margin-left step (renders `<p style="margin-left: 24px">`).
 */
export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Math.round((parseInt(element.style.marginLeft, 10) || 0) / STEP_PX),
            renderHTML: (attributes) => (attributes.indent > 0 ? { style: `margin-left: ${attributes.indent * STEP_PX}px` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const shift = (delta: 1 | -1) => ({ editor, commands }: { editor: import('@tiptap/core').Editor; commands: import('@tiptap/core').SingleCommands }) => {
      if (editor.isActive('listItem')) return delta > 0 ? commands.sinkListItem('listItem') : commands.liftListItem('listItem');
      const current = (editor.getAttributes('paragraph').indent as number | undefined) ?? 0;
      return commands.updateAttributes('paragraph', { indent: Math.min(MAX_STEPS, Math.max(0, current + delta)) });
    };
    return { indent: () => shift(1), outdent: () => shift(-1) };
  },
});
