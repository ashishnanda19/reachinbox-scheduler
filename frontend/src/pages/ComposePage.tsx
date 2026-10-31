import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { Clock, Paperclip } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { createCampaign } from '../api/campaigns';
import type { AttachmentUpload } from '../api/types';
import { AttachmentsStrip } from '../components/compose/AttachmentsStrip';
import { AUTO_SENDER, FromSelect } from '../components/compose/FromSelect';
import { RecipientsField } from '../components/compose/RecipientsField';
import { RichTextEditor } from '../components/compose/RichTextEditor';
import { SendLaterPopover } from '../components/compose/SendLaterPopover';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { queryKeys } from '../hooks/useQueries';
import { formatSize } from '../lib/date';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const SEND_NOW_DELAY_SECONDS = 10;

const NUMBER_INPUT =
  'h-[42px] w-[78px] rounded-lg border border-[#E6E6E6] bg-card px-3 text-center text-[16px] text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none';

async function toUpload(file: File): Promise<AttachmentUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { filename: file.name, contentType: file.type || 'application/octet-stream', dataBase64: btoa(binary) };
}

export function ComposePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sender, setSender] = useState(AUTO_SENDER);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [html, setHtml] = useState('');
  const [bodyEmpty, setBodyEmpty] = useState(true);
  const [sendAt, setSendAt] = useState<Dayjs | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [laterOpen, setLaterOpen] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const touch = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const delay = delaySeconds === '' ? 0 : Number(delaySeconds);
  const limit = hourlyLimit === '' ? NaN : Number(hourlyLimit);
  const errors = useMemo(
    () => ({
      recipients: recipients.length === 0 ? 'Add at least one valid recipient.' : undefined,
      subject: subject.trim() ? undefined : 'Subject is required.',
      body: bodyEmpty ? 'Write a message.' : undefined,
      delay: Number.isFinite(delay) && delay >= 0 ? undefined : 'Delay must be 0 seconds or more.',
      limit: Number.isInteger(limit) && limit >= 1 ? undefined : 'Hourly limit must be at least 1.',
    }),
    [recipients, subject, bodyEmpty, delay, limit],
  );
  const valid = Object.values(errors).every((e) => !e);

  function addFiles(chosen: FileList | null) {
    if (!chosen) return;
    const next = [...files];
    for (const file of Array.from(chosen)) {
      const total = next.reduce((sum, f) => sum + f.size, 0) + file.size;
      if (next.length >= MAX_FILES) toast.error(`You can attach up to ${MAX_FILES} files`);
      else if (file.size > MAX_FILE_BYTES) toast.error(`${file.name} is larger than 2 MB (${formatSize(file.size)})`);
      else if (total > MAX_TOTAL_BYTES) toast.error('Attachments can total at most 5 MB');
      else next.push(file);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = '';
  }

  const send = useMutation({
    mutationFn: async () =>
      createCampaign({
        subject: subject.trim(),
        body: html,
        recipients,
        startTime: (sendAt ?? dayjs().add(SEND_NOW_DELAY_SECONDS, 's')).toISOString(),
        delayBetweenMs: Math.round(delay * 1000),
        hourlyLimit: limit,
        senderId: sender === AUTO_SENDER ? undefined : sender,
        attachments: files.length > 0 ? await Promise.all(files.map(toUpload)) : undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Scheduled ${result.total} emails`);
      if (result.hourlyLimit < limit) toast(`Hourly limit was capped at ${result.hourlyLimit} by the server`, { icon: 'ℹ️' });
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      navigate('/scheduled');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submitting = send.isPending;
  const show = (field: keyof typeof errors) => (touched[field] ? errors[field] : undefined);

  return (
    <div className="relative min-h-screen bg-white pb-16">
      <PageHeader title="Compose New Email">
        <IconButton label="Attach files" active={files.length > 0} onClick={() => fileInput.current?.click()} className="mr-[11px]">
          <Paperclip size={26} strokeWidth={1.5} />
          {files.length > 0 && <span className="absolute bottom-[3px] right-[3px] text-[9px] font-medium leading-none">{files.length}</span>}
        </IconButton>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <IconButton label="Send later" active={sendAt !== null} onClick={() => setLaterOpen((v) => !v)} className="mr-[15px]" title={sendAt ? `Scheduled for ${sendAt.format('MMM D, h:mm A')}` : 'Send later'}>
          <Clock size={24} strokeWidth={1.5} />
        </IconButton>
        <Button
          variant="outline"
          disabled={!valid || submitting}
          onClick={() => send.mutate()}
          className="h-[38px] w-[111px] rounded-full text-[16px] font-normal disabled:!opacity-100"
        >
          {submitting ? 'Scheduling…' : sendAt ? 'Send Later' : 'Send'}
        </Button>
      </PageHeader>

      <SendLaterPopover open={laterOpen} onClose={() => setLaterOpen(false)} value={sendAt} onDone={setSendAt} />

      <form onSubmit={(e) => e.preventDefault()} className="mx-auto w-[1156px] max-w-full pt-2 max-[1220px]:px-6">
        <div className="flex h-16 items-center">
          <label className="w-[60px] shrink-0 text-[15px] text-ink">From</label>
          <FromSelect value={sender} onChange={setSender} />
        </div>

        <div className="flex min-h-16 items-center">
          <label className="w-[60px] shrink-0 text-[15px] text-ink">To</label>
          <div className="min-w-0 flex-1">
            <RecipientsField recipients={recipients} onChange={(r) => { setRecipients(r); touch('recipients'); }} onBlur={() => touch('recipients')} error={show('recipients')} />
          </div>
        </div>

        <div className="flex min-h-16 items-center">
          <label htmlFor="subject" className="w-[60px] shrink-0 text-[15px] text-ink">Subject</label>
          <div className="min-w-0 flex-1">
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => touch('subject')}
              placeholder="Subject"
              className="h-[45px] w-full border-b border-line bg-transparent pl-[13px] text-[18px] text-ink"
            />
            {show('subject') && <p className="mt-1 pl-[10px] text-[12px] text-danger">{show('subject')}</p>}
          </div>
        </div>

        <div className="flex h-[58px] items-center">
          <label htmlFor="delay" className="mr-4 text-[15px] text-ink" title="Seconds to wait between two emails">Delay between 2 emails</label>
          <Input id="delay" type="number" min={0} step="any" value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} onBlur={() => touch('delay')} placeholder="00" title="Seconds between two emails" className={NUMBER_INPUT} />
          <label htmlFor="limit" className="ml-[31px] mr-4 text-[15px] text-ink" title="Maximum emails per hour for each sender">Hourly Limit</label>
          <Input id="limit" type="number" min={1} step={1} value={hourlyLimit} onChange={(e) => setHourlyLimit(e.target.value)} onBlur={() => touch('limit')} placeholder="00" title="Emails per hour, per sender" className={NUMBER_INPUT} />
          <span className="ml-4 text-[12px] text-danger">{show('delay') ?? show('limit')}</span>
        </div>

        <div className="mt-3">
          <RichTextEditor onChange={(value, empty) => { setHtml(value); setBodyEmpty(empty); }} onBlur={() => touch('body')} />
          {show('body') && <p className="mt-1 text-[12px] text-danger">{show('body')}</p>}
          <AttachmentsStrip files={files} onRemove={(index) => setFiles(files.filter((_, i) => i !== index))} />
        </div>
      </form>
    </div>
  );
}
