{
  "session_id": "f626e543-6d48-4dfb-bc85-6532f5a096b5",
  "response": "",
  "stats": {
    "models": {
      "gemini-3.1-pro-preview": {
        "api": {
          "totalRequests": 14,
          "totalErrors": 0,
          "totalLatencyMs": 90459
        },
        "tokens": {
          "input": 150299,
          "prompt": 360331,
          "candidates": 1040,
          "total": 365910,
          "cached": 210032,
          "thoughts": 4539,
          "tool": 0
        },
        "roles": {
          "main": {
            "totalRequests": 14,
            "totalErrors": 0,
            "totalLatencyMs": 90459,
            "tokens": {
              "input": 150299,
              "prompt": 360331,
              "candidates": 1040,
              "total": 365910,
              "cached": 210032,
              "thoughts": 4539,
              "tool": 0
            }
          }
        }
      }
    },
    "tools": {
      "totalCalls": 17,
      "totalSuccess": 17,
      "totalFail": 0,
      "totalDurationMs": 157,
      "totalDecisions": {
        "accept": 17,
        "reject": 0,
        "modify": 0,
        "auto_accept": 0
      },
      "byName": {
        "update_topic": {
          "count": 1,
          "success": 1,
          "fail": 0,
          "durationMs": 8,
          "decisions": {
            "accept": 1,
            "reject": 0,
            "modify": 0,
            "auto_accept": 0
          }
        },
        "read_file": {
          "count": 13,
          "success": 13,
          "fail": 0,
          "durationMs": 66,
          "decisions": {
            "accept": 13,
            "reject": 0,
            "modify": 0,
            "auto_accept": 0
          }
        },
        "glob": {
          "count": 1,
          "success": 1,
          "fail": 0,
          "durationMs": 10,
          "decisions": {
            "accept": 1,
            "reject": 0,
            "modify": 0,
            "auto_accept": 0
          }
        },
        "grep_search": {
          "count": 2,
          "success": 2,
          "fail": 0,
          "durationMs": 73,
          "decisions": {
            "accept": 2,
            "reject": 0,
            "modify": 0,
            "auto_accept": 0
          }
        }
      }
    },
    "files": {
      "totalLinesAdded": 0,
      "totalLinesRemoved": 0
    }
  },
  "error": {
    "type": "INVALID_STREAM",
    "message": "Invalid stream: The model returned an empty response or malformed tool call."
  }
}Ripgrep is not available. Falling back to GrepTool.
(node:98578) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
