export interface RandomSource {
  next(): number;
}

export const mathRandomSource: RandomSource = {
  next: () => Math.random(),
};
