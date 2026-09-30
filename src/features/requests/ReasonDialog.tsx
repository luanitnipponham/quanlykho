import { useState, type ReactNode } from 'react';
import { Button, Field, Modal, Textarea } from '../../ui/primitives';

export interface ReasonRequest {
  title: string;
  label: string;
  confirm: string;
  danger?: boolean;
  intro?: ReactNode;
  /** Reason is a free note rather than a requirement (e.g. T2 Hủy đơn). */
  optional?: boolean;
  run: (reason: string) => Promise<boolean> | boolean;
}

/** Modal that collects the mandatory reason of a transition (T4, T5, A1–A4). */
export function ReasonDialog({ req, onClose }: { req: ReasonRequest; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={req.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Quay lại
          </Button>
          <Button
            variant={req.danger ? 'danger' : 'primary'}
            disabled={(!req.optional && !reason.trim()) || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await req.run(reason.trim());
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {req.confirm}
          </Button>
        </>
      }
    >
      {req.intro && <div className="mb-4 text-sm text-slate-600">{req.intro}</div>}
      <Field label={req.label} required={!req.optional} htmlFor="reason">
        <Textarea id="reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
