import PlayingCard from '../../components/PlayingCard.jsx';

// Renders one mode's rules from data.
export default function RulesContent({ mode }) {
  if (mode.sections.length === 0) {
    return (
      <div className="rules-placeholder" role="note">
        <p className="rules-placeholder__title">Rules coming soon</p>
        <p>
          The full rules for {mode.label} have not been added yet. This page will show them here as soon as they are
          provided.
        </p>
      </div>
    );
  }
  return (
    <article className="rules-content">
      {mode.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs?.map((text) => (
            <p key={text}>{text}</p>
          ))}
          {section.items && (
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {/* seeing the cards beats remembering a description of them */}
          {section.cards && (
            <ul className="rules-cards" aria-label="What the cards look like">
              {section.cards.map(({ name, ...card }) => (
                <li key={name}>
                  <PlayingCard {...card} size="sm" ariaLabel={name} />
                  <span aria-hidden="true">{name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
