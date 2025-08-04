#!/bin/bash

# Local GitHub Actions Testing Script
# Provides convenient commands for testing workflows locally with Act

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Act binary path
ACT_BIN="$HOME/.local/bin/act"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if Act is installed
    if ! command -v "$ACT_BIN" &> /dev/null; then
        print_error "Act is not installed. Please run the installation script first."
        exit 1
    fi
    
    print_success "Act is installed: $($ACT_BIN --version)"
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        print_warning "Docker is not available. Please enable Docker Desktop WSL integration."
        print_warning "See setup-local-testing.md for instructions."
        return 1
    fi
    
    # Test Docker connectivity
    if ! docker version &> /dev/null; then
        print_warning "Docker daemon is not running or not accessible."
        print_warning "Please start Docker Desktop and enable WSL integration."
        return 1
    fi
    
    print_success "Docker is available and running"
    return 0
}

# Function to list workflows
list_workflows() {
    print_status "Available workflows:"
    "$ACT_BIN" --list
}

# Function to run dry run
dry_run() {
    local job_name="$1"
    print_status "Running dry run for job: $job_name"
    "$ACT_BIN" --dryrun -j "$job_name"
}

# Function to run workflow locally
run_workflow() {
    local job_name="$1"
    local event="${2:-push}"
    
    print_status "Running workflow locally..."
    print_status "Job: $job_name"
    print_status "Event: $event"
    
    if check_prerequisites; then
        "$ACT_BIN" -j "$job_name" --verbose
    else
        print_warning "Running in dry-run mode due to Docker issues"
        "$ACT_BIN" --dryrun -j "$job_name"
    fi
}

# Function to test specific workflow with event
test_workflow() {
    local workflow_file="$1"
    local event="${2:-push}"
    
    print_status "Testing workflow file: $workflow_file"
    print_status "Event: $event"
    
    if check_prerequisites; then
        "$ACT_BIN" -W ".github/workflows/$workflow_file" "$event" --verbose
    else
        print_warning "Running in dry-run mode due to Docker issues"
        "$ACT_BIN" --dryrun -W ".github/workflows/$workflow_file" "$event"
    fi
}

# Function to run quick validation
quick_validation() {
    print_status "Running quick validation tests..."
    
    # List of quick jobs to test
    local quick_jobs=("code-quality" "validate")
    
    for job in "${quick_jobs[@]}"; do
        print_status "Testing $job..."
        if check_prerequisites; then
            "$ACT_BIN" -j "$job" --verbose
        else
            print_warning "Running $job in dry-run mode"
            "$ACT_BIN" --dryrun -j "$job"
        fi
    done
}

# Function to show help
show_help() {
    cat << EOF
Local GitHub Actions Testing Script

Usage: $0 [COMMAND] [OPTIONS]

Commands:
  list                     List all available workflows
  dry-run <job>           Run dry-run for specific job
  run <job> [event]       Run workflow locally (default event: push)
  test <workflow> [event] Test specific workflow file
  quick                   Run quick validation tests
  check                   Check prerequisites
  help                    Show this help message

Examples:
  $0 list                          # List all workflows
  $0 dry-run code-quality         # Dry run code quality checks
  $0 run code-quality             # Run code quality checks locally
  $0 run validate push            # Run validation with push event
  $0 test ci.yml pull_request     # Test CI workflow with PR event
  $0 quick                        # Run quick validation tests
  $0 check                        # Check prerequisites

Common Jobs:
  - code-quality: Code Quality Checks
  - validate: Validate Build and Tests
  - enhanced-test-validation: Enhanced Test Suite
  - mcp-protocol-validation: MCP Protocol Compliance
  - cageerf-framework-validation: CAGEERF Framework Validation
  - performance-baseline: Performance Monitoring

For more information, see setup-local-testing.md
EOF
}

# Main script logic
case "$1" in
    list)
        list_workflows
        ;;
    dry-run)
        if [ -z "$2" ]; then
            print_error "Job name is required for dry-run"
            echo "Usage: $0 dry-run <job_name>"
            exit 1
        fi
        dry_run "$2"
        ;;
    run)
        if [ -z "$2" ]; then
            print_error "Job name is required for run"
            echo "Usage: $0 run <job_name> [event]"
            exit 1
        fi
        run_workflow "$2" "$3"
        ;;
    test)
        if [ -z "$2" ]; then
            print_error "Workflow file is required for test"
            echo "Usage: $0 test <workflow_file> [event]"
            exit 1
        fi
        test_workflow "$2" "$3"
        ;;
    quick)
        quick_validation
        ;;
    check)
        check_prerequisites
        ;;
    help|--help|-h)
        show_help
        ;;
    "")
        print_error "No command specified"
        show_help
        exit 1
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac