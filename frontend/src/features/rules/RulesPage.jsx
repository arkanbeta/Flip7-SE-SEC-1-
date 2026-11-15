import { useState } from 'react';
import Page from '../../components/Page.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Tabs from '../../components/Tabs.jsx';
import { MODE_RULES } from './rulesData.js';
import RulesContent from './RulesContent.jsx';
import './RulesPage.css';

export default function RulesPage() {
  const [activeId, setActiveId] = useState(MODE_RULES[0].id);
  const mode = MODE_RULES.find((entry) => entry.id === activeId) ?? MODE_RULES[0];
  const tabs = MODE_RULES.map(({ id, label }) => ({ id, label }));

  return (
    <Page>
      <PageHeader title="Rules" />
      <div className="surface rules-card">
        {/* Tabs only once there is something to switch between; one mode is just shown. */}
        {tabs.length > 1 ? (
          <Tabs tabs={tabs} value={mode.id} onChange={setActiveId} label="Game modes">
            <RulesContent mode={mode} />
          </Tabs>
        ) : (
          <>
            <p className="rules-mode">{mode.label}</p>
            <RulesContent mode={mode} />
          </>
        )}
      </div>
    </Page>
  );
}
