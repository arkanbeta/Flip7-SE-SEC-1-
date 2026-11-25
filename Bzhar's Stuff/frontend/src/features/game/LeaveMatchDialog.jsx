import Modal from '../../components/Modal.jsx';
import Button from '../../components/Button.jsx';
import './GameBoard.css';

// Walking out of a running match costs the player their points, so we ask first.
export default function LeaveMatchDialog({ open, busy, onCancel, onConfirm }) {
  return (
    <Modal open={open} onClose={onCancel} title="Leave the match?">
      <p>
        If you leave now you get <strong>no points</strong> for this match, and you cannot come back to it.
        The other players carry on without you.
      </p>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onCancel}>
          Stay in the match
        </Button>
        <Button onClick={onConfirm} loading={busy} className="btn--danger">
          Leave and lose my points
        </Button>
      </div>
    </Modal>
  );
}
