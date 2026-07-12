/**
 * Static placeholder content for the Phase 2 shell screens, mirroring the prototype's mock data so the screens read exactly like the design reference. Phase 3 replaces every consumer of this module with real reads from Supabase — nothing here is ever written to or fetched from the database.
 */

export type PlaceholderMember = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export type PlaceholderGroup = {
  id: string;
  name: string;
  memberIds: string[];
  currentTurnMemberId: string;
  deadlineLabel: string;
  timeLeftLabel: string;
  isMyTurn: boolean;
  lastUpdate: string;
};

export type PlaceholderActivityItem = {
  id: string;
  memberId: string;
  text: string;
  timeLabel: string;
  passedToMemberId: string;
};

export const PLACEHOLDER_MEMBERS: PlaceholderMember[] = [
  { id: 'u1', name: 'Maya Chen', initials: 'MC', color: '#7B61FF' },
  { id: 'u2', name: 'Jordan Park', initials: 'JP', color: '#00D4AA' },
  { id: 'u3', name: 'Sam Rivera', initials: 'SR', color: '#FF9A2E' },
  { id: 'u4', name: 'Priya Nair', initials: 'PN', color: '#FF4E3A' },
  { id: 'u5', name: 'Leo Tanaka', initials: 'LT', color: '#FF6B9D' },
  { id: 'u6', name: 'Zara Ali', initials: 'ZA', color: '#4ECAFF' },
];

export const PLACEHOLDER_GROUPS: PlaceholderGroup[] = [
  {
    id: 'g1',
    name: 'Weekend Crew',
    memberIds: ['u1', 'u2', 'u3', 'u4'],
    currentTurnMemberId: 'u1',
    deadlineLabel: '6h',
    timeLeftLabel: '4h 22m',
    isMyTurn: true,
    lastUpdate: 'Jordan: "Finally tried that ramen spot — mind blown 🍜"',
  },
  {
    id: 'g2',
    name: 'Book Club Chaos',
    memberIds: ['u1', 'u5', 'u6', 'u2'],
    currentTurnMemberId: 'u5',
    deadlineLabel: '1 day',
    timeLeftLabel: '18h 5m',
    isMyTurn: false,
    lastUpdate: 'Zara: "I give this book 3/5 chaotic stars"',
  },
  {
    id: 'g3',
    name: 'Fam Vibes',
    memberIds: ['u1', 'u3', 'u4'],
    currentTurnMemberId: 'u3',
    deadlineLabel: '1h',
    timeLeftLabel: '47m',
    isMyTurn: false,
    lastUpdate: 'Priya: "Mom made her famous biryani again 🌟"',
  },
];

export const PLACEHOLDER_ACTIVITY: PlaceholderActivityItem[] = [
  {
    id: 'a1',
    memberId: 'u2',
    text: 'Finally tried that ramen spot on Broad St — mind completely blown. The broth took 3 days apparently. Going back next weekend for sure 🍜',
    timeLabel: '2h ago',
    passedToMemberId: 'u1',
  },
  {
    id: 'a2',
    memberId: 'u4',
    text: 'Finished the big project at work! Four months of stress just… done. Celebrated with a long walk and a cold brew ☕',
    timeLabel: '8h ago',
    passedToMemberId: 'u2',
  },
  {
    id: 'a3',
    memberId: 'u3',
    text: 'Rediscovered my old sketchbooks from college. I used to draw every single day. Thinking about picking it back up.',
    timeLabel: '1d ago',
    passedToMemberId: 'u4',
  },
  {
    id: 'a4',
    memberId: 'u1',
    text: 'Hiked the ridge trail for the first time in forever. Views hit different in autumn. Should we do a group hike?',
    timeLabel: '2d ago',
    passedToMemberId: 'u3',
  },
];

export function getPlaceholderMember(id: string): PlaceholderMember {
  const member = PLACEHOLDER_MEMBERS.find((m) => m.id === id);
  if (!member) {
    throw new Error(`Unknown placeholder member id: ${id}`);
  }
  return member;
}
