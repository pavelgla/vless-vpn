import Modal from './Modal';

export default function ConfirmModal({ title, message, onConfirm, onClose, loading }) {
  return (
    <Modal title={title} onClose={onClose} size="sm">
      <p className="text-gray-300 mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button className="btn-ghost" onClick={onClose} disabled={loading}>
          Отмена
        </button>
        <button className="btn-danger" onClick={onConfirm} disabled={loading}>
          {loading ? 'Удаление...' : 'Удалить'}
        </button>
      </div>
    </Modal>
  );
}
