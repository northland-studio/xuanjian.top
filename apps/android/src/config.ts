export const API_BASE_URL = 'https://xuanjian.top/api';

export interface User {
    id: number;
    username: string;
    nickname: string;
    email?: string;
    avatar?: string;
    level: number;
    is_email_verified: boolean;
    created_at: string;
    contribution?: number;
    posts_count?: number;
    comments_count?: number;
    likes_count?: number;
}

export interface Post {
    id: number;
    title: string;
    content: string;
    type: 'daily' | 'decision' | 'forum';
    author_id: number;
    author_username?: string;
    author_nickname?: string;
    author_avatar?: string;
    images?: string[];
    tags?: string;
    views: number;
    likes: number;
    is_pinned: boolean;
    created_at: string;
    updated_at?: string;
    isLiked?: boolean;
}

export interface Comment {
    id: number;
    post_id: number;
    author_id: number;
    author_username?: string;
    author_nickname?: string;
    author_avatar?: string;
    content: string;
    parent_id?: number;
    reply_to?: { id: number; nickname: string };
    replies?: Comment[];
    created_at: string;
}

export interface Notification {
    id: number;
    type: 'post_daily' | 'post_decision' | 'comment' | 'like';
    title: string;
    content?: string;
    post_id?: number;
    post_title?: string;
    actor_id?: number;
    actor_nickname?: string;
    is_read: boolean;
    created_at: string;
}

export interface Stock {
    id: number;
    symbol: string;
    name: string;
    description?: string;
    base_price: number;
    current_price: number;
    total_shares: number;
    available_shares: number;
    volatility: number;
    trend: number;
    is_active: number;
    updated_at: string;
}

export interface StockHolding {
    stock_id: number;
    symbol: string;
    name: string;
    shares: number;
    avg_cost: number;
    current_price: number;
    current_value: number;
    profit_loss: number;
}

export interface StockTransaction {
    id: number;
    stock_id: number;
    symbol: string;
    name: string;
    type: 'buy' | 'sell';
    shares: number;
    price: number;
    total_cost: number;
    created_at: string;
}

export interface CheckinStatus {
    todayCheckedIn: boolean;
    continuousDays: number;
    totalCheckins: number;
    maxContinuousDays: number;
    makeupCards: number;
    totalContribution: number;
    todayReward: number;
    rewards: Array<{ continuous_days: number; reward_points: number; description: string }>;
    recentCheckins: Array<{ checkin_date: string; continuous_days: number; reward_points: number }>;
}

export interface AppState {
    token: string | null;
    currentUser: User | null;
    currentPage: string;
    sidebarOpen: boolean;
    theme: 'light' | 'dark';
}

export const state: AppState = {
    token: localStorage.getItem('token'),
    currentUser: JSON.parse(localStorage.getItem('user') || 'null'),
    currentPage: 'home',
    sidebarOpen: false,
    theme: (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
};
