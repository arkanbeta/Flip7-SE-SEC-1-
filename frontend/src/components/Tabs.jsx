import { useRef } from 'react';
import './Tabs.css';

// Accessible tab list (WAI-ARIA pattern): Left/Right arrows move between tabs, Home/End jump
// to the first/last, and only the active tab is in the Tab order.
//   tabs:   [{ id, label }]    value: id of the active tab    onChange(id)
//   children: the content of the active tab (rendered inside the tabpanel)
export default function Tabs({ tabs, value, onChange, label, children }) {
  const tabRefs = useRef({});

  function focusTab(index) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    onChange(tab.id);
    tabRefs.current[tab.id]?.focus();
  }

  function handleKeyDown(event, index) {
    const keys = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      focusTab(keys[event.key]);
    }
  }

  return (
    <div className="tabs">
      <div className="tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={`tabs__tab${selected ? ' tabs__tab--active' : ''}`}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div id={`panel-${value}`} role="tabpanel" aria-labelledby={`tab-${value}`} className="tabs__panel" tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
