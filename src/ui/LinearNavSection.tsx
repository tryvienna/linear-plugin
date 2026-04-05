/**
 * LinearNavSection — Nav sidebar canvas for the Linear plugin.
 *
 * Shows a list of Linear issues with filtering and grouping.
 * Settings button opens the LinearSettingsDrawer.
 */

import { useState, useEffect, useCallback } from 'react';
import { usePluginQuery } from '@tryvienna/sdk/react';
import {
  NavSection,
  NavItem,
  NavSettingsButton,
  NavHeaderActions,
} from '@tryvienna/ui';
import type { NavSidebarCanvasProps } from '@tryvienna/sdk';
import { Settings } from 'lucide-react';
import { useLinearSettings } from './useLinearSettings';
import { GET_LINEAR_ISSUES } from '../client/operations';

// ─────────────────────────────────────────────────────────────────────────────
// Types & helpers
// ─────────────────────────────────────────────────────────────────────────────

interface LinearIssueNav {
  id: string;
  title: string;
  identifier: string;
  status: string;
  stateName: string;
  priority: number;
  priorityLabel: string;
  assigneeName?: string;
  teamKey?: string;
  labels?: { name: string; color: string }[];
  projectName?: string;
}

const priorityColors: Record<number, string> = {
  1: 'var(--status-error)',
  2: 'var(--status-warning)',
  3: 'var(--text-secondary)',
  4: 'var(--text-muted)',
};

function groupIssues(issues: LinearIssueNav[], groupBy: string): Map<string, LinearIssueNav[]> {
  const groups = new Map<string, LinearIssueNav[]>();
  for (const issue of issues) {
    let key: string;
    switch (groupBy) {
      case 'status':
        key = issue.stateName || 'Unknown';
        break;
      case 'priority':
        key = issue.priorityLabel || 'No priority';
        break;
      case 'label':
        key = issue.labels?.[0]?.name || 'No Label';
        break;
      case 'project':
        key = issue.projectName || 'No Project';
        break;
      default:
        key = '';
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(issue);
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function IssueNavItem({ issue, onSelect }: { issue: LinearIssueNav; onSelect: () => void }) {
  return (
    <NavItem
      item={{
        id: issue.id,
        label: issue.title || '(No title)',
        variant: 'item' as const,
        meta: (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {issue.priority > 0 && (
              <span style={{ color: priorityColors[issue.priority] || 'var(--text-muted)', fontWeight: 600 }}>
                P{issue.priority}
              </span>
            )}
            <span>{issue.identifier}</span>
          </span>
        ),
      }}
      onSelect={onSelect}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function LinearNavSection({
  pluginId,
  openPluginDrawer,
  openEntityDrawer,
  hostApi,
}: NavSidebarCanvasProps) {
  const { settings } = useLinearSettings();

  // Track whether credentials are configured. Starts false and
  // is checked on mount + whenever the settings drawer fires a change event.
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const [keys, oauth] = await Promise.all([
          hostApi.getCredentialStatus('linear'),
          hostApi.getOAuthStatus('linear'),
        ]);
        if (cancelled) return;
        const hasKey = keys.some((k) => k.isSet);
        const hasOAuth = oauth.some((p) => p.connected);
        setIsAuthenticated(hasKey || hasOAuth);
      } catch {
        // ignore
      }
    };
    check();
    // Re-check when settings drawer signals a credential change
    const handler = () => { check(); };
    window.addEventListener('vienna-plugin:linear:settings-changed', handler);
    return () => { cancelled = true; window.removeEventListener('vienna-plugin:linear:settings-changed', handler); };
  }, [hostApi]);

  // Fetch issues — resolver returns [] when not authenticated.
  // No polling once authenticated; re-fetch triggered by Apollo cache / settings changes.
  const { data, loading, error } = usePluginQuery<{ linearIssues: LinearIssueNav[] }>(GET_LINEAR_ISSUES, {
    variables: {
      limit: settings.limit,
      teamId: settings.teamId === 'all' ? undefined : settings.teamId,
      assignmentFilter: settings.assignment === 'all' ? undefined : settings.assignment,
      statusTypes: settings.statusTypes,
    },
    skip: !isAuthenticated,
    fetchPolicy: 'cache-and-network',
  });

  const issues: LinearIssueNav[] = data?.linearIssues ?? [];

  const handleIssueSelect = useCallback((issue: LinearIssueNav) => {
    openEntityDrawer(`@vienna//linear_issue/${issue.id}`);
  }, [openEntityDrawer]);

  const sectionData = {
    id: `plugin-${pluginId}-nav`,
    label: `Linear${issues.length ? ` (${issues.length})` : ''}`,
    items: [],
    isLoading: isAuthenticated && loading && !data,
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            openPluginDrawer({ view: 'settings' });
          }}
          ariaLabel="Linear settings"
        />
      </NavHeaderActions>
    ),
    emptyState: !isAuthenticated
      ? 'Add an API key in settings to get started'
      : error && !data
        ? error.message
        : 'No issues found',
  };

  // Not configured — show setup prompt
  if (!isAuthenticated) {
    return (
      <NavSection section={sectionData} defaultExpanded>
        <NavItem
          item={{
            id: 'setup',
            label: 'Open Settings to configure',
            variant: 'item',
            icon: <Settings size={14} />,
          }}
          onSelect={() => openPluginDrawer({ view: 'settings' })}
        />
      </NavSection>
    );
  }

  // Grouped view
  if (settings.groupBy !== 'none' && issues.length > 0) {
    const groups = groupIssues(issues, settings.groupBy);

    return (
      <NavSection section={sectionData} defaultExpanded>
        {Array.from(groups.entries()).map(([groupName, groupIssues]) => (
          <div key={groupName}>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '8px 12px 2px',
              }}
            >
              {groupName}
            </div>
            {groupIssues.map((issue) => (
              <IssueNavItem
                key={issue.id}
                issue={issue}
                onSelect={() => handleIssueSelect(issue)}
              />
            ))}
          </div>
        ))}
      </NavSection>
    );
  }

  // Flat view
  return (
    <NavSection section={sectionData} defaultExpanded>
      {issues.map((issue) => (
        <IssueNavItem
          key={issue.id}
          issue={issue}
          onSelect={() => handleIssueSelect(issue)}
        />
      ))}
    </NavSection>
  );
}
