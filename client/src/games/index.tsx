import type { ComponentType } from 'react';
import type { GameView } from '../../../shared/protocol';
import { Bomb } from './Bomb';
import { Memory } from './Memory';
import { Precision } from './Precision';
import { Quiz } from './Quiz';
import { Reaction } from './Reaction';

type ViewOf<K extends GameView['kind']> = Extract<GameView, { kind: K }>;

/** Client-side game registry: view.kind -> component. */
export const GAME_COMPONENTS: { [K in GameView['kind']]: ComponentType<{ view: ViewOf<K> }> } = {
  reaction: Reaction,
  memory: Memory,
  precision: Precision,
  quiz: Quiz,
  bomb: Bomb,
};

export function GameStage({ view }: { view: GameView }) {
  const C = GAME_COMPONENTS[view.kind] as ComponentType<{ view: GameView }>;
  return <C view={view} />;
}
