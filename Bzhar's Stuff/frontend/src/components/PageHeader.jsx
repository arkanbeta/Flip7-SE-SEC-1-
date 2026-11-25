import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from './icons.jsx';
import './PageHeader.css';

// Top of the inner pages (profile, rules): a way back and the page title.
export default function PageHeader({ title, backTo = '/lobby', backLabel = 'Lobby' }) {
  return (
    <header className="page-header">
      <Link to={backTo} className="page-header__back">
        <ArrowLeftIcon size={20} />
        <span>{backLabel}</span>
      </Link>
      <h1 className="page-header__title">{title}</h1>
    </header>
  );
}
