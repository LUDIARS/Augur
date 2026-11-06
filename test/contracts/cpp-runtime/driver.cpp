// Test driver for templates/contract-runtime/contract-runtime.hpp.
//
//   driver <epoch-ms> <scenario>
//
// Each invocation is one process, so the per-process "day already checked"
// cache starts empty exactly like a fresh module instance in the TypeScript
// suite. Results are printed to stdout for the test to compare.
#include "../../../templates/contract-runtime/contract-runtime.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

const augur::ContractSpec kSpec{"C-1", "marker", "src/a.cpp:1"};

int verdicts() {
  auto doubled = augur::contract([](int value) { return value * 2; }, kSpec, augur::NoPredicate{},
                                 [](int result, int) -> augur::Verdict {
                                   return result > 0 ? augur::pass() : augur::fail("not positive");
                                 });
  std::cout << doubled(2) << " " << doubled(-1);

  auto boom = augur::contract([]() -> int { throw std::runtime_error("boom"); }, kSpec,
                              []() -> bool { throw std::runtime_error("predicate"); });
  try {
    boom();
    std::cout << " no-throw";
  } catch (const std::runtime_error& error) {
    std::cout << " " << error.what();
  }

  // bool and string predicates, and a void function whose post sees only the arguments.
  auto guarded = augur::contract([](int) {}, kSpec, [](int value) { return value > 0; },
                                 [](int value) { return std::string(value > 5 ? "" : "small"); });
  guarded(-3);
  guarded(9);
  std::cout << "\n";
  return 0;
}

int ok() {
  std::cout << augur::contract([]() { return std::string("ok"); }, kSpec)() << "\n";
  return 0;
}

int escaped() {
  const augur::ContractSpec spec{"C-\"2\"", "line\nbreak", "C:\\src\\a.cpp:3"};
  augur::contract([]() { return 1; }, spec)();
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) return 64;
  augur::testing::now_override().store(std::stoll(argv[1]));
  const std::string scenario = argv[2];
  if (scenario == "verdicts") return verdicts();
  if (scenario == "ok") return ok();
  if (scenario == "escaped") return escaped();
  return 65;
}
