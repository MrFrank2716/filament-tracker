import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Menu, RotateCcw } from 'lucide-react';
import { NAV_PAGES } from '@/components/layout/navPages';
import { Button, IconButton } from '@/components/ui/Button';
import { Muted, SectionTitle } from '@/components/ui/Display';
import { Checkbox } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import {
  ALWAYS_SHOWN,
  DEFAULT_LAYOUT,
  MAX_TAB_BAR,
  NAV_SHOWN,
  isDefaultLayout,
  movePage,
  normalizeLayout,
  setInTabBar,
  setShown,
  shownOn,
  type NavLayout,
} from '@/lib/navigation';
import type { User } from '@/lib/types';
import styles from '@/components/settings/Navigation.module.css';

const pageById = new Map(NAV_PAGES.map((page) => [page.id, page]));

/** The signed-in user's own order for the main navigation, where each page shows, and which pages sit in the phone tab bar. */
export function NavigationSection() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  // Quick clicks send overlapping saves. Only the newest one's answer may touch the screen, or an older
  // reply would put back a stale order and the next click would build on it.
  const latest = useRef(0);
  if (!user) return null;

  const layout = normalizeLayout(user.navigation);

  // Shows at once (the sidebar reads the same user record), then saves; a failed save puts the old order back.
  const save = (next: NavLayout) => {
    if (next === layout) return;
    const previous = user;
    const standard = isDefaultLayout(next);
    const request = ++latest.current;
    updateUser({ ...user, navigation: standard ? null : next });
    api
      .patch<{ user: User }>('/auth/me/navigation', { layout: standard ? null : next })
      .then(({ user: saved }) => {
        if (request === latest.current) updateUser(saved);
      })
      .catch((error: unknown) => {
        if (request !== latest.current) return;
        updateUser(previous);
        toast(error instanceof Error ? error.message : 'Could not save your navigation', 'danger');
      });
  };

  const full = layout.tabBar.length >= MAX_TAB_BAR;
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };

  return (
    <>
      <SectionTitle>Navigation</SectionTitle>
      <Muted>
        Put the pages you use most at the top, and choose where each one shows: on both, only in the desktop sidebar, only on a phone, or hidden.
        On a phone, up to {MAX_TAB_BAR} sit in the bar at the bottom and the rest are under More. A hidden page still opens from a link or a
        scanned label. This is your own layout: it follows you to any device and does not change what other members see.
      </Muted>

      <ol className={styles.list}>
        {layout.order.map((id, index) => {
          const page = pageById.get(id);
          if (!page) return null;
          const inBar = layout.tabBar.includes(id);
          const shown = shownOn(layout, id);
          const onPhone = shown === 'both' || shown === 'phone';
          const isTarget = over === index && dragging !== null && dragging !== index;
          return (
            <li
              key={id}
              className={[styles.row, dragging === index ? styles.dragging : '', isTarget ? styles.over : ''].join(' ')}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', id);
                setDragging(index);
              }}
              onDragOver={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) save(movePage(layout, dragging, index));
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              <GripVertical className={styles.grip} size={16} aria-hidden />
              <page.icon size={20} aria-hidden />
              <span className={styles.name}>{page.label}</span>
              <span className={styles.shown} role="radiogroup" aria-label={'Where ' + page.label + ' shows'}>
                {NAV_SHOWN.map((option) => (
                  <label key={option.id} className={styles.shownOption}>
                    <input
                      type="radio"
                      className={styles.shownInput}
                      name={'shown-' + id}
                      checked={shown === option.id}
                      disabled={id === ALWAYS_SHOWN}
                      onChange={() => save(setShown(layout, id, option.id))}
                    />
                    <span className={styles.shownLabel}>{option.label}</span>
                  </label>
                ))}
              </span>
              <span className={styles.bar}>
                <Checkbox
                  label="Phone tab bar"
                  checked={inBar}
                  disabled={inBar ? layout.tabBar.length <= 1 : full || !onPhone}
                  onChange={(on) => save(setInTabBar(layout, id, on))}
                />
              </span>
              <span className={styles.moves}>
                <IconButton icon={ArrowUp} label={'Move ' + page.label + ' up'} size="sm" disabled={index === 0} onClick={() => save(movePage(layout, index, index - 1))} />
                <IconButton
                  icon={ArrowDown}
                  label={'Move ' + page.label + ' down'}
                  size="sm"
                  disabled={index === layout.order.length - 1}
                  onClick={() => save(movePage(layout, index, index + 1))}
                />
              </span>
            </li>
          );
        })}
      </ol>
      {full && <Muted>The tab bar is full. Untick a page to make room for another.</Muted>}

      <SectionTitle>On a phone</SectionTitle>
      <div className={styles.phoneBar} aria-label="Phone tab bar preview" role="img">
        {layout.order
          .filter((id) => layout.tabBar.includes(id))
          .map((id) => {
            const page = pageById.get(id);
            return (
              page && (
                <span key={id} className={styles.phoneTab}>
                  <page.icon size={18} aria-hidden />
                  {page.label}
                </span>
              )
            );
          })}
        <span className={styles.phoneTab}>
          <Menu size={18} aria-hidden />
          More
        </span>
      </div>

      <div>
        <Button icon={RotateCcw} disabled={isDefaultLayout(layout)} onClick={() => save(DEFAULT_LAYOUT)}>
          Reset to standard
        </Button>
      </div>
    </>
  );
}
