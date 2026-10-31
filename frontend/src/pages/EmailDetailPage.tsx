import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, Star, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import { apiUrl } from '../api/client';
import { cancelEmail } from '../api/emails';
import type { EmailDetail } from '../api/types';
import { AttachmentCard } from '../components/emails/AttachmentCard';
import { PageHeader } from '../components/layout/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Skeleton } from '../components/ui/Skeleton';
import { useStarred } from '../hooks/useStarred';
import { queryKeys, useEmail, useMe } from '../hooks/useQueries';
import { cn } from '../lib/cn';
import { formatDetailDate, formatFullDate } from '../lib/date';
import { sanitizeForDisplay } from '../lib/html';

const attachmentUrl = (email: EmailDetail, index: number) => apiUrl(`/api/emails/${email.id}/attachments/${index}`);

function DetailsPanel({ email }: { email: EmailDetail }) {
  const rows: [string, React.ReactNode][] = [
    ['From', `${email.senderName} <${email.senderEmail}>`],
    ['To', email.recipient],
    ['Status', email.status + (email.error ? `: ${email.error}` : '')],
    ['Scheduled', formatFullDate(email.scheduledAt)],
    ['Sent', email.sentAt ? formatFullDate(email.sentAt) : 'Not sent yet'],
    ['Attempts', String(email.attempts)],
    ['Ethereal preview', email.previewUrl ? <a href={email.previewUrl} target="_blank" rel="noreferrer" className="text-brand-text underline">Open preview</a> : 'Available after sending'],
    ['Message ID', email.messageId ?? 'None yet'],
  ];
  return (
    <dl className="mt-3 grid max-w-[640px] grid-cols-[130px_1fr] gap-x-4 gap-y-1 rounded-[10px] bg-field px-4 py-3 text-[14px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmailDetailPage() {
  const { id = '' } = useParams();
  const { data: email, isPending, error, refetch } = useEmail(id);
  const me = useMe().data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isStarred, toggle } = useStarred();
  const [showDetails, setShowDetails] = useState(false);

  const html = useMemo(() => (email ? sanitizeForDisplay(email.body) : ''), [email]);
  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate(email && (email.status === 'sent' || email.status === 'failed') ? '/sent' : '/scheduled'));

  const cancel = useMutation({
    mutationFn: () => cancelEmail(id),
    onSuccess: () => {
      toast.success('Email cancelled');
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      navigate('/scheduled', { replace: true });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      void refetch();
    },
  });

  const canCancel = email?.status === 'scheduled';
  const onTrash = () => {
    if (window.confirm('Cancel this scheduled email? It will not be sent.')) cancel.mutate();
  };

  return (
    <div className="min-h-screen bg-white">
      <PageHeader title={email?.subject ?? ''} onBack={goBack}>
        {email && (
          <>
            <IconButton label={isStarred(email.id) ? 'Unstar' : 'Star'} onClick={() => toggle(email.id)}>
              <Star size={23} strokeWidth={1.5} className={cn(isStarred(email.id) && 'fill-star-active text-star-active')} />
            </IconButton>
            <IconButton label="Archive" title="Not available" disabled className="ml-2 disabled:!opacity-100">
              <Archive size={23} strokeWidth={1.5} />
            </IconButton>
            <IconButton
              label="Cancel email"
              title={canCancel ? 'Cancel this scheduled email' : 'Only scheduled emails can be cancelled'}
              disabled={!canCancel || cancel.isPending}
              onClick={onTrash}
              className="ml-2 disabled:!opacity-100"
            >
              <Trash2 size={23} strokeWidth={1.5} />
            </IconButton>
          </>
        )}
        <span className="ml-[8px] mr-[19px] h-9 w-px bg-[#D5D8D5]" aria-hidden />
        {me && <Avatar name={me.name} src={me.avatar_url} size={36} />}
      </PageHeader>

      <div className="mx-auto w-[1156px] max-w-full pt-[21px] max-[1220px]:px-6">
        {isPending && (
          <div aria-busy className="space-y-4">
            <div className="flex items-center gap-[17px]">
              <Skeleton className="h-[46px] w-[46px] rounded-full" />
              <Skeleton className="h-5 w-[320px]" />
            </div>
            <Skeleton className="ml-[63px] h-4 w-[420px]" />
            <Skeleton className="ml-[63px] h-4 w-[360px]" />
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-center gap-4 pt-10 text-[16px] text-danger">
            {error.message}
            <Button variant="outline" onClick={() => void refetch()} className="h-8 rounded-full px-4 text-[14px]">
              Retry
            </Button>
          </div>
        )}

        {email && (
          <article>
            <div className="flex items-start gap-[17px]">
              <Avatar name={email.senderName} size={46} solid />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 pt-[2px]">
                  <span className="text-[18px] font-bold leading-6 text-ink-strong">{email.senderName}</span>
                  <span className="truncate text-[16px] text-ink-muted">&lt;{email.senderEmail}&gt;</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails}
                  className="mt-[7px] flex items-center gap-1 text-[14px] text-ink-muted"
                >
                  to {email.recipient}
                  <ChevronDown size={14} strokeWidth={1.5} className={cn('transition', showDetails && 'rotate-180')} />
                </button>
                {showDetails && <DetailsPanel email={email} />}
              </div>
              <time className="shrink-0 pt-[3px] text-[15px] text-[#6D6E70]" dateTime={email.sentAt ?? email.scheduledAt}>
                {formatDetailDate(email.sentAt ?? email.scheduledAt)}
              </time>
            </div>

            <div className="ml-[63px] mt-[30px] text-[17px] leading-[1.6] text-[#303235]">
              <div className="email-body" dangerouslySetInnerHTML={{ __html: html }} />

              {email.attachments.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-5">
                  {email.attachments.map((file) => (
                    <AttachmentCard
                      key={file.index}
                      filename={file.filename}
                      size={file.size}
                      thumbnailUrl={file.contentType.startsWith('image/') ? attachmentUrl(email, file.index) : undefined}
                      onOpen={() => window.open(attachmentUrl(email, file.index), '_blank', 'noopener')}
                    />
                  ))}
                </div>
              )}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
