import { Club } from './clubs';

export interface DbClub {
  club_id: number;
  name: string;
  description: string;
  category: string;
  meeting_time: string;
  meeting_day?: string;
  location: string;
  contact_email: string;
  sponsor_name?: string;
  dues?: string;
  instagram_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  remind_url?: string;
  images?: string[];
  events?: { name: string; date: string }[];
}

/**
 * Fetch clubs from the database API
 */
export async function getClubsFromDatabase(): Promise<Club[]> {
  try {
    const response = await fetch('/api/clubs', {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch clubs: ${response.status}`);
    }

    const dbClubs: DbClub[] = await response.json();

    // Transform database clubs to match Club interface
    return dbClubs.map(club => ({
      id: club.club_id,
      name: club.name,
      description: club.description,
      category: club.category,
      time: club.meeting_time,
      day: club.meeting_day ?? '',
      location: club.location,
      dues: club.dues ?? '',
      sponsor: {
        name: club.sponsor_name ?? '',
        email: club.contact_email,
      },
      socials: {
        instagram: club.instagram_url,
        twitter: club.twitter_url,
        facebook: club.facebook_url,
        remind: club.remind_url,
      },
      events: club.events ?? [],
      images: club.images ?? [],
      tags: [club.category],
    }));
  } catch (error) {
    console.error('Error fetching clubs from database:', error);
    throw error;
  }
}

/**
 * Get a single club from the database by ID
 */
export async function getClubFromDatabase(clubId: number): Promise<Club | null> {
  try {
    const response = await fetch(
      `/api/clubs/${clubId}`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to fetch club: ${response.status}`);
    }

    const dbClub: DbClub = await response.json();

    return {
      id: dbClub.club_id,
      name: dbClub.name,
      description: dbClub.description,
      category: dbClub.category,
      time: dbClub.meeting_time,
      day: dbClub.meeting_day ?? '',
      location: dbClub.location,
      dues: dbClub.dues ?? '',
      sponsor: {
        name: dbClub.sponsor_name ?? '',
        email: dbClub.contact_email,
      },
      socials: {
        instagram: dbClub.instagram_url,
        twitter: dbClub.twitter_url,
        facebook: dbClub.facebook_url,
        remind: dbClub.remind_url,
      },
      events: dbClub.events ?? [],
      images: dbClub.images ?? [],
      tags: [dbClub.category],
    };
  } catch (error) {
    console.error(`Error fetching club ${clubId} from database:`, error);
    throw error;
  }
}