import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayingCard from '../components/PlayingCard.jsx';
import Tabs from '../components/Tabs.jsx';
import { normalizeRoomCode, isValidRoomCode } from '../utils/roomCode.js';
import { formatSigned } from '../utils/format.js';

describe('PlayingCard', () => {
  it('is a labelled static image when it has no click handler', () => {
    render(<PlayingCard label="7" />);
    expect(screen.getByRole('img', { name: 'Card 7' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('describes a face-down card without revealing its value', () => {
    render(<PlayingCard label="7" faceUp={false} />);
    expect(screen.getByRole('img', { name: 'Face-down card' })).toBeTruthy();
  });

  it('toggles the face-up class (the CSS flip) from the faceUp prop', () => {
    const { rerender } = render(<PlayingCard label="7" faceUp={false} />);
    expect(screen.getByRole('img').className).not.toContain('is-face-up');
    rerender(<PlayingCard label="7" faceUp />);
    expect(screen.getByRole('img').className).toContain('is-face-up');
  });

  it('becomes a real button when clickable, and a disabled card cannot be clicked', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<PlayingCard label="9" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Card 9' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<PlayingCard label="9" onClick={onClick} state="disabled" />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('supports sizes and states through classes', () => {
    render(<PlayingCard label="3" size="lg" state="danger" />);
    const card = screen.getByRole('img');
    expect(card.className).toContain('playing-card--lg');
    expect(card.className).toContain('playing-card--danger');
  });
});

describe('Tabs', () => {
  function Demo() {
    const [value, setValue] = useState('a');
    return (
      <Tabs tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]} value={value} onChange={setValue} label="Demo">
        <p>content of {value}</p>
      </Tabs>
    );
  }

  it('shows the active tab and changes on click', async () => {
    render(<Demo />);
    expect(screen.getByText('content of a')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('content of b')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true');
  });

  it('supports arrow keys, wrapping, Home and End, with only the active tab tabbable', async () => {
    render(<Demo />);
    screen.getByRole('tab', { name: 'A' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('content of b')).toBeTruthy();
    await userEvent.keyboard('{End}');
    expect(screen.getByText('content of c')).toBeTruthy();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('content of a')).toBeTruthy();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByText('content of c')).toBeTruthy();
    await userEvent.keyboard('{Home}');
    expect(screen.getByText('content of a')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('tabindex')).toBe('-1');
  });
});

describe('helpers', () => {
  it('normalizeRoomCode upper-cases, strips symbols and caps the length', () => {
    expect(normalizeRoomCode(' ab-c d!')).toBe('ABCD');
    expect(normalizeRoomCode('abcdefghijklm')).toBe('ABCDEFGHIJ');
    expect(normalizeRoomCode('http://localhost:5173/rooms/3v7uj9')).toBe('3V7UJ9'); // a pasted room link
  });
  it('isValidRoomCode wants 4-10 upper-case letters or digits', () => {
    expect(isValidRoomCode('ABCD')).toBe(true);
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('ABCDEFGHIJK')).toBe(false);
    expect(isValidRoomCode('abcd')).toBe(false);
  });
  it('formatSigned adds a plus only to positive numbers', () => {
    expect(formatSigned(12)).toBe('+12');
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(-3)).toBe('-3');
  });
});
