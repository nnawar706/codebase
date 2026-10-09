// Generated from the live schema by the Supabase MCP (generate_typescript_types).
// Regenerate after every migration rather than editing by hand.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          adapter: string | null
          commit_sha: string | null
          coverage: Json | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          org_id: string
          project_id: string
          stage: string | null
          stage_message: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          adapter?: string | null
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          org_id: string
          project_id: string
          stage?: string | null
          stage_message?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          adapter?: string | null
          commit_sha?: string | null
          coverage?: Json | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          org_id?: string
          project_id?: string
          stage?: string | null
          stage_message?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_project_id_org_id_fkey"
            columns: ["project_id", "org_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          id: string
          kind: string
          org_id: string
          source_file_id: string
          target_file_id: string
        }
        Insert: {
          analysis_id: string
          id?: string
          kind: string
          org_id: string
          source_file_id: string
          target_file_id: string
        }
        Update: {
          analysis_id?: string
          id?: string
          kind?: string
          org_id?: string
          source_file_id?: string
          target_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "edges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_source_file_id_analysis_id_org_id_fkey"
            columns: ["source_file_id", "analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "org_id"]
          },
          {
            foreignKeyName: "edges_target_file_id_analysis_id_org_id_fkey"
            columns: ["target_file_id", "analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "org_id"]
          },
        ]
      }
      explanations: {
        Row: {
          analysis_id: string
          content: string
          created_at: string
          file_id: string
          id: string
          model: string
          org_id: string
        }
        Insert: {
          analysis_id: string
          content: string
          created_at?: string
          file_id: string
          id?: string
          model: string
          org_id: string
        }
        Update: {
          analysis_id?: string
          content?: string
          created_at?: string
          file_id?: string
          id?: string
          model?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "explanations_file_id_analysis_id_org_id_fkey"
            columns: ["file_id", "analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "org_id"]
          },
          {
            foreignKeyName: "explanations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      file_roles: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          org_id: string
          role: string
          source: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          org_id: string
          role: string
          source: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          org_id?: string
          role?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "file_roles_file_id_analysis_id_org_id_fkey"
            columns: ["file_id", "analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "org_id"]
          },
          {
            foreignKeyName: "file_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          analysis_id: string
          hash: string
          id: string
          lines: number
          org_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          hash: string
          id?: string
          lines: number
          org_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          hash?: string
          id?: string
          lines?: number
          org_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          content: string
          created_at: string
          id: string
          org_id: string
        }
        Insert: {
          analysis_id: string
          content: string
          created_at?: string
          id?: string
          org_id: string
        }
        Update: {
          analysis_id?: string
          content?: string
          created_at?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "insights_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          id: string
          org_id: string
          repo_name: string
          repo_owner: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          repo_name: string
          repo_owner: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          repo_name?: string
          repo_owner?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          file_id: string
          id: string
          line: number
          method: string
          org_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          file_id: string
          id?: string
          line: number
          method: string
          org_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          file_id?: string
          id?: string
          line?: number
          method?: string
          org_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_org_id_fkey"
            columns: ["analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "routes_file_id_analysis_id_org_id_fkey"
            columns: ["file_id", "analysis_id", "org_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id", "analysis_id", "org_id"]
          },
          {
            foreignKeyName: "routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      store_parse: {
        Args: {
          p_adapter: string
          p_analysis_id: string
          p_commit_sha: string
          p_coverage: Json
          p_edges: Json
          p_files: Json
          p_routes: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
