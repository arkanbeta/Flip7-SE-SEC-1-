import { avatarUrl } from '../utils/avatars.js';
import './Avatar.css';

// A round avatar picture. `id` is the value stored in Users.avatar.
// If the id is unknown (should not happen), a neutral circle with the initial is shown.
export default function Avatar({ id, name = '', size = 48, className = '' }) {
  const url = avatarUrl(id);
  const style = { width: size, height: size };
  if (!url) {
    return (
      <span className={`avatar avatar--fallback ${className}`.trim()} style={style} role="img" aria-label={name}>
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <img className={`avatar ${className}`.trim()} src={url} alt={name} style={style} />;
}
