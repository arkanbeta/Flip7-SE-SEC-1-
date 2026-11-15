// Small outline icons (24x24, drawn with the current text colour). They are decorative:
// the button or link that contains them always carries the accessible text.
function Icon({ children, size = 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PlusCircleIcon = (props) => (
  <Icon {...props}><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></Icon>
);
export const EnterIcon = (props) => (
  <Icon {...props}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></Icon>
);
export const BookIcon = (props) => (
  <Icon {...props}><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></Icon>
);
export const ArrowLeftIcon = (props) => (
  <Icon {...props}><path d="M19 12H5M12 19l-7-7 7-7" /></Icon>
);
export const PencilIcon = (props) => (
  <Icon {...props}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Icon>
);
export const LogOutIcon = (props) => (
  <Icon {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></Icon>
);
