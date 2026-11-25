// The built-in avatar collection. Every SVG in assets/avatars is picked up
// automatically; the file name (without .svg) is the id stored in Users.avatar.
// The backend keeps its own allowlist of the same ids (a backend test fails if the
// two ever differ), so an id that is not in both places is never accepted.
const files = import.meta.glob('../assets/avatars/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const AVATARS = Object.entries(files)
  .map(([path, url]) => {
    const id = path.split('/').pop().replace('.svg', '');
    return { id, label: id.charAt(0).toUpperCase() + id.slice(1), url };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export const avatarUrl = (id) => AVATARS.find((avatar) => avatar.id === id)?.url ?? null;
