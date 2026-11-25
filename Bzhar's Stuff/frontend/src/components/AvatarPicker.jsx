import { AVATARS } from '../utils/avatars.js';
import './AvatarPicker.css';

// Native radio buttons (visually replaced by the pictures), so keyboard and
// screen-reader behaviour comes for free: Tab to the group, arrow keys to choose.
export default function AvatarPicker({ value, onChange, legend = 'Choose your avatar' }) {
  return (
    <fieldset className="avatar-picker">
      <legend>{legend}</legend>
      <div className="avatar-picker__grid">
        {AVATARS.map((avatar) => (
          <label key={avatar.id} className="avatar-option">
            <input
              type="radio"
              name="avatar"
              value={avatar.id}
              checked={value === avatar.id}
              onChange={() => onChange(avatar.id)}
            />
            <img src={avatar.url} alt={avatar.label} width="64" height="64" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
