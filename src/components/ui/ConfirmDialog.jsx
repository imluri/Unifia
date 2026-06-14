import React from 'react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';

// Confirmation popup built on Modal. `danger` styles the confirm button red.
export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-sm text-neutral-300">{message}</p>}
    </Modal>
  );
}
