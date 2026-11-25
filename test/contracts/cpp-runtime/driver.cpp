// Test driver for templates/contract-runtime/contract-runtime.hpp.
//
//   driver <epoch-ms> <scenario>
//
// Each invocation is one process, so the per-process "day already checked"
// cache starts empty exactly like a fresh module instance in the TypeScript
// suite. Results are printed to stdout for the test to compare.
#include "../../../templates/contract-runtime/contract-runtime.hpp"

#include <cstdlib>
#include <initializer_list>
#include <iostream>
#include <limits>
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

int sampling() {
  auto spec = kSpec;
  spec.sample = 0.5;
  augur::testing::random_override().store(0.5);
  const auto two = [] {
    return 2;
  };
  if (augur::contract(two, spec)() != 2) return 1;
  const auto fails = [](auto...) {
    return false;
  };
  augur::contract(two, spec, fails, fails)();
  const auto throws = [](auto...) -> bool {
    throw std::runtime_error("predicate");
  };
  augur::contract(two, spec, throws, throws)();
  augur::testing::random_override().store(0.49);
  augur::contract([] {}, spec)();
  return 0;
}

int full_sampling() {
  augur::testing::random_override().store(0.99);
  const auto one = [] {
    return 1;
  };
  augur::contract(one, kSpec)();
  auto spec = kSpec;
  for (const double sample : {1.0, 0.0, -0.1, 1.1, std::numeric_limits<double>::quiet_NaN(),
                              std::numeric_limits<double>::infinity()}) {
    spec.sample = sample;
    augur::contract(one, spec)();
  }
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
  if (scenario == "sampling") return sampling();
  if (scenario == "full-sampling") return full_sampling();
  if (scenario == "escaped") return escaped();
  return 65;
}
