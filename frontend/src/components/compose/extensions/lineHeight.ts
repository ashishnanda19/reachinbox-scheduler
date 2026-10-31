import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (value: string) => ReturnType;
    };
  }
}

/** Line spacing as a paragraph attribute (renders `<p style="line-height: ..">`). */
export const LineHeight = Extension.create({
  name: 'lineHeight',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) => (attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight:
        (value) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { lineHeight: value === '1' ? null : value }),
    };
  },
});
