export type ViewableMap = Record<string, boolean>;

export interface Profile {
  compositeID: string;
  type: string;

  fname: string;
  lname: string;
  pronouns: string;
  major: string;
  year: string;

  hobby1: string;
  hobby2: string;
  funQuestion1: string;
  funQuestion2: string;

  linkedIn: string;
  profilePictureURL: string;
  additionalLink: string;
  description: string;

  createdAt: number;
  updatedAt: number;

  profileType: string;
  viewableMap: ViewableMap;

  [key: string]: any;
}

export type ProfileUpdateData = {
  fname?: string;
  lname?: string;
  pronouns?: string;
  major?: string;
  year?: string;
  hobby1?: string;
  hobby2?: string;
  funQuestion1?: string;
  funQuestion2?: string;
  linkedIn?: string;
  profilePictureURL?: string;
  additionalLink?: string;
  description?: string;
  profileType?: string;
};

export interface MemberData {
  pronouns?: string;
  major?: string;
  year?: string;
}
