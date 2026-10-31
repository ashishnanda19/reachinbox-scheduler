import { useEffect, useMemo } from 'react';
import { AttachmentCard } from '../emails/AttachmentCard';

interface AttachmentsStripProps {
  files: File[];
  onRemove: (index: number) => void;
}

/** The chosen files below the editor, as the same cards the email detail uses. */
export function AttachmentsStrip({ files, onRemove }: AttachmentsStripProps) {
  const previews = useMemo(() => files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined)), [files]);
  useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

  if (files.length === 0) return null;
  return (
    <div className="mt-[18px] flex flex-wrap gap-5">
      {files.map((file, index) => (
        <AttachmentCard key={`${file.name}-${index}`} filename={file.name} size={file.size} thumbnailUrl={previews[index]} onRemove={() => onRemove(index)} />
      ))}
    </div>
  );
}
