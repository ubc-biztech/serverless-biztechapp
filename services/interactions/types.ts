export type Node = {
  id: string;
  name: string;
  avatar?: string;
  major?: string;
  year?: string;
};

export type EdgePayload = {
  type: string;
  createdAt: number;
  from: Node;
  to: Node;
};
